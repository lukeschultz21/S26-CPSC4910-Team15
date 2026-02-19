require('dotenv').config();

const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const path = require("path");
const { getPool } = require("./db");

const app = express();
app.set("trust proxy", 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    name: "team15.sid",
    secret: process.env.SESSION_SECRET || "CHANGE_ME_IN_BEANSTALK",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: 1000 * 60 * 60 * 6
    }
  })
);

app.use(express.static(path.join(__dirname, "public")));

function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Not logged in" });
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.session.user) return res.status(401).json({ error: "Not logged in" });
    if (req.session.user.role !== role) return res.status(403).json({ error: "Forbidden" });
    next();
  };
}

async function getRole(pool, userId) {
  console.log("Getting role for user:", userId);
  
  const [adminRows] = await pool.query("SELECT 1 FROM ADMIN WHERE user_id = ? LIMIT 1", [userId]);
  console.log("Admin rows:", adminRows.length);
  if (adminRows.length) return "admin";

  const [sponsorRows] = await pool.query("SELECT 1 FROM SPONSORUSERS WHERE user_id = ? LIMIT 1", [userId]);
  console.log("Sponsor rows:", sponsorRows.length);
  if (sponsorRows.length) return "sponsor";

  const [driverRows] = await pool.query("SELECT 1 FROM DRIVERS WHERE user_id = ? LIMIT 1", [userId]);
  console.log("Driver rows:", driverRows.length);
  if (driverRows.length) return "driver";

  console.log("No role found, returning user");
  return "user";
}

app.get("/health", (req, res) => res.json({ ok: true }));

app.get("/dbcheck", async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query("SELECT NOW() AS now");
    res.json({ ok: true, now: rows[0].now });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/api/me", (req, res) => {
  res.json({ user: req.session.user || null });
});

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email and password required" });

    const pool = getPool();
    const [rows] = await pool.query(
      "SELECT user_id, email, password_hash, status, first_name, last_name FROM USERS WHERE email = ? LIMIT 1",
      [email]
    );

    if (!rows.length) return res.status(401).json({ error: "Invalid credentials" });

    const user = rows[0];

    if (user.status && String(user.status).toLowerCase() !== "active") {
      return res.status(403).json({ error: "Account not active" });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    const role = await getRole(pool, user.user_id);
    req.session.user = {
      user_id: user.user_id,
      email: user.email,
      role,
      name: `${user.first_name || ""} ${user.last_name || ""}`.trim()
    };

    res.json({ ok: true, role, redirect: `/${role}/dashboard.html` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// Change Password Route
app.post("/api/change-password", requireAuth, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    const userId = req.session.user.user_id;

    // Validate inputs
    if (!current_password || !new_password) {
      return res.status(400).json({ error: "Current password and new password required" });
    }

    if (current_password === new_password) {
      return res.status(400).json({ error: "New password must be different from current password" });
    }

    // Password validation rules (same as registration)
    const PASSWORD_RULES = {
      minLength: 8,
      requireUppercase: true,
      requireLowercase: true,
      requireNumbers: true,
      requireSpecialChar: true,
      specialChars: '!@#$%^&*()_+-=[]{}|;:",.<>?'
    };

    // Validate new password
    const errors = [];
    if (new_password.length < PASSWORD_RULES.minLength) {
      errors.push(`Password must be at least ${PASSWORD_RULES.minLength} characters long`);
    }
    if (PASSWORD_RULES.requireUppercase && !/[A-Z]/.test(new_password)) {
      errors.push('Password must contain at least 1 uppercase letter');
    }
    if (PASSWORD_RULES.requireLowercase && !/[a-z]/.test(new_password)) {
      errors.push('Password must contain at least 1 lowercase letter');
    }
    if (PASSWORD_RULES.requireNumbers && !/[0-9]/.test(new_password)) {
      errors.push('Password must contain at least 1 number');
    }
    if (PASSWORD_RULES.requireSpecialChar) {
      const hasSpecialChar = PASSWORD_RULES.specialChars.split('').some(char => new_password.includes(char));
      if (!hasSpecialChar) {
        errors.push('Password must contain at least 1 special character');
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({ error: errors[0] });
    }

    // Get current password from database
    const pool = getPool();
    const [rows] = await pool.query(
      "SELECT password_hash FROM USERS WHERE user_id = ? LIMIT 1",
      [userId]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "User not found" });
    }

    // Verify current password
    const user = rows[0];
    const passwordMatch = await bcrypt.compare(current_password, user.password_hash);
    
    if (!passwordMatch) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }

    // Hash new password
    const newHash = await bcrypt.hash(new_password, 10);

    // Update password in database
    await pool.query(
      "UPDATE USERS SET password_hash = ?, updated_at = NOW() WHERE user_id = ?",
      [newHash, userId]
    );

    res.json({ ok: true, message: "Password changed successfully" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/register", async (req, res) => {
  try {
    const { email, password, first_name, last_name } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email and password required" });

    // Password validation rules (backend)
    const PASSWORD_RULES = {
      minLength: 8,
      requireUppercase: true,
      requireLowercase: true,
      requireNumbers: true,
      requireSpecialChar: true,
      specialChars: '!@#$%^&*()_+-=[]{}|;:",.<>?'
    };

    // Validate password
    const errors = [];
    if (password.length < PASSWORD_RULES.minLength) {
      errors.push(`Password must be at least ${PASSWORD_RULES.minLength} characters long`);
    }
    if (PASSWORD_RULES.requireUppercase && !/[A-Z]/.test(password)) {
      errors.push('Password must contain at least 1 uppercase letter');
    }
    if (PASSWORD_RULES.requireLowercase && !/[a-z]/.test(password)) {
      errors.push('Password must contain at least 1 lowercase letter');
    }
    if (PASSWORD_RULES.requireNumbers && !/[0-9]/.test(password)) {
      errors.push('Password must contain at least 1 number');
    }
    if (PASSWORD_RULES.requireSpecialChar) {
      const hasSpecialChar = PASSWORD_RULES.specialChars.split('').some(char => password.includes(char));
      if (!hasSpecialChar) {
        errors.push('Password must contain at least 1 special character');
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({ error: errors[0] });
    }

    const pool = getPool();
    const hash = await bcrypt.hash(password, 10);

    const [result] = await pool.query(
      "INSERT INTO USERS (email, password_hash, first_name, last_name, status, created_at) VALUES (?, ?, ?, ?, 'active', NOW())",
      [email, hash, first_name || null, last_name || null]
    );

    req.session.user = { user_id: result.insertId, email, role: "user", name: `${first_name || ""} ${last_name || ""}`.trim() };
    res.json({ ok: true, redirect: "/user/dashboard.html" });
  } catch (e) {
    if (String(e.message || "").toLowerCase().includes("duplicate")) {
      return res.status(409).json({ error: "Email already exists" });
    }
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/driver/points", requireRole("driver"), async (req, res) => {
  try {
    const pool = getPool();
    const userId = req.session.user.user_id;

    const [rows] = await pool.query(
      "SELECT current_points FROM DRIVERPOINTBALANCES WHERE user_id = ? LIMIT 1",
      [userId]
    );

    res.json({ ok: true, current_points: rows.length ? Number(rows[0].current_points) : 0 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/driver/transactions", requireRole("driver"), async (req, res) => {
  try {
    const pool = getPool();
    const userId = req.session.user.user_id;

    const [rows] = await pool.query(
      "SELECT * FROM POINTTRANSACTIONS WHERE user_id = ? ORDER BY transaction_date DESC LIMIT 25",
      [userId]
    );

    res.json({ ok: true, transactions: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/sponsor/pending-applications", requireRole("sponsor"), async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      "SELECT * FROM DRIVERAPPLICATIONS WHERE application_status = 'pending' ORDER BY submitted_at DESC LIMIT 50"
    );
    res.json({ ok: true, applications: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/admin/stats", requireRole("admin"), async (req, res) => {
  try {
    const pool = getPool();
    const [[u]] = await pool.query("SELECT COUNT(*) AS users FROM USERS");
    res.json({ ok: true, users: Number(u.users) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// DRIVER POINT HISTORY ENDPOINT
// ============================================================
app.get("/api/driver/point-history", requireRole("driver"), async (req, res) => {
  try {
    const pool = getPool();
    const userId = req.session.user.user_id;

    const [transactions] = await pool.query(
      `SELECT 
        transaction_id,
        point_change,
        reason,
        created_at as transaction_date,
        actor_user_id
      FROM POINTTRANSACTIONS 
      WHERE user_id = ? 
      ORDER BY created_at DESC 
      LIMIT 100`,
      [userId]
    );

    res.json({ ok: true, transactions });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/login", (req, res) => res.sendFile(path.join(__dirname, "public", "login.html")));
app.get("/about", (req, res) => res.sendFile(path.join(__dirname, "public", "about.html")));
app.get("/change-password", (req, res) => res.sendFile(path.join(__dirname, "public", "change-password.html")));

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Listening on ${port}`));