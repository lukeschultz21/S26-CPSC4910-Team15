require("dotenv").config();

const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
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

// Ensure uploads directory exists (for profile photos)
const uploadsDir = path.join(__dirname, "public", "uploads");
try {
  fs.mkdirSync(uploadsDir, { recursive: true });
} catch (_) {
  // ignore
}

// Multer upload config (stores files in /public/uploads)
const upload = multer({ dest: uploadsDir });

function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Not logged in" });
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user) return res.status(401).json({ error: "Not logged in" });
    if (!roles.includes(req.session.user.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }
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

// -----------------------------
// Profile APIs (used by avatar menu + profile page)
// -----------------------------

// Get current user's profile data
app.get("/api/profile", requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const userId = req.session.user.user_id;

    const [rows] = await pool.query(
      `SELECT user_id, email, first_name, last_name,
              username, title, bio, birthday, photo_url
       FROM USERS
       WHERE user_id = ?
       LIMIT 1`,
      [userId]
    );

    if (!rows.length) return res.status(404).json({ error: "User not found" });
    res.json({ ok: true, profile: rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Update current user's profile fields
app.put("/api/profile", requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const userId = req.session.user.user_id;

    const { username, title, first_name, last_name, email, birthday, bio } = req.body;

    // NOTE: removed updated_at because your USERS table doesn't have it
    await pool.query(
      `UPDATE USERS
       SET username = ?,
           title = ?,
           first_name = ?,
           last_name = ?,
           email = ?,
           birthday = ?,
           bio = ?
       WHERE user_id = ?`,
      [
        username || null,
        title || null,
        first_name || null,
        last_name || null,
        email || null,
        birthday || null,
        bio || null,
        userId
      ]
    );

    // Keep session info fresh
    if (email) req.session.user.email = email;
    req.session.user.name = `${first_name || ""} ${last_name || ""}`.trim();

    res.json({ ok: true });
  } catch (e) {
    const msg = String(e.message || "").toLowerCase();
    if (msg.includes("duplicate")) {
      return res.status(409).json({ error: "Email/username already exists" });
    }
    res.status(500).json({ error: e.message });
  }
});

// Update current user's password (simple endpoint for profile page)
app.put("/api/profile/password", requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const userId = req.session.user.user_id;
    const { password } = req.body;

    if (!password || String(password).length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }

    const hash = await bcrypt.hash(password, 10);

    // NOTE: removed updated_at because your USERS table doesn't have it
    await pool.query("UPDATE USERS SET password_hash = ? WHERE user_id = ?", [hash, userId]);

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Upload current user's profile photo
app.post("/api/profile/photo", requireAuth, upload.single("photo"), async (req, res) => {
  try {
    const pool = getPool();
    const userId = req.session.user.user_id;

    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    // Stored under /public/uploads
    const photoUrl = `/uploads/${req.file.filename}`;

    // NOTE: removed updated_at because your USERS table doesn't have it
    await pool.query("UPDATE USERS SET photo_url = ? WHERE user_id = ?", [photoUrl, userId]);

    res.json({ ok: true, photo_url: photoUrl });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    // Frontend can send either "email" or "identifier"
    const identifier = (req.body.identifier || req.body.email || "").trim();
    const { password } = req.body;

    if (!identifier || !password) {
      return res.status(400).json({ error: "Email/username and password required" });
    }

    const pool = getPool();

    // Login with either email OR username
    const [rows] = await pool.query(
      `SELECT user_id, email, username, password_hash, status, first_name, last_name
       FROM USERS
       WHERE email = ? OR username = ?
       LIMIT 1`,
      [identifier, identifier]
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
      errors.push("Password must contain at least 1 uppercase letter");
    }
    if (PASSWORD_RULES.requireLowercase && !/[a-z]/.test(new_password)) {
      errors.push("Password must contain at least 1 lowercase letter");
    }
    if (PASSWORD_RULES.requireNumbers && !/[0-9]/.test(new_password)) {
      errors.push("Password must contain at least 1 number");
    }
    if (PASSWORD_RULES.requireSpecialChar) {
      const hasSpecialChar = PASSWORD_RULES.specialChars.split("").some((char) => new_password.includes(char));
      if (!hasSpecialChar) {
        errors.push("Password must contain at least 1 special character");
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({ error: errors[0] });
    }

    // Get current password from database
    const pool = getPool();
    const [rows] = await pool.query("SELECT password_hash FROM USERS WHERE user_id = ? LIMIT 1", [userId]);

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
    // NOTE: removed updated_at because your USERS table doesn't have it
    await pool.query("UPDATE USERS SET password_hash = ? WHERE user_id = ?", [newHash, userId]);

    res.json({ ok: true, message: "Password changed successfully" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/register", async (req, res) => {
  try {
    const {
      email,
      password,
      first_name,
      last_name,
      username,
      title,
      bio,
      birthday
    } = req.body;

    if (!email || !password) return res.status(400).json({ error: "Email and password required" });
    if (!username) return res.status(400).json({ error: "Username is required" });

    // Password validation rules (backend)
    const PASSWORD_RULES = {
      minLength: 8,
      requireUppercase: true,
      requireLowercase: true,
      requireNumbers: true,
      requireSpecialChar: true,
      specialChars: '!@#$%^&*()_+-=[]{}|;:",.<>?'
    };

    const errors = [];
    if (password.length < PASSWORD_RULES.minLength) errors.push(`Password must be at least ${PASSWORD_RULES.minLength} characters long`);
    if (PASSWORD_RULES.requireUppercase && !/[A-Z]/.test(password)) errors.push("Password must contain at least 1 uppercase letter");
    if (PASSWORD_RULES.requireLowercase && !/[a-z]/.test(password)) errors.push("Password must contain at least 1 lowercase letter");
    if (PASSWORD_RULES.requireNumbers && !/[0-9]/.test(password)) errors.push("Password must contain at least 1 number");
    if (PASSWORD_RULES.requireSpecialChar) {
      const hasSpecialChar = PASSWORD_RULES.specialChars.split("").some((char) => password.includes(char));
      if (!hasSpecialChar) errors.push("Password must contain at least 1 special character");
    }
    if (errors.length) return res.status(400).json({ error: errors[0] });

    const pool = getPool();
    const hash = await bcrypt.hash(password, 10);

    // Everyone starts as a plain "user". getRole() will later return sponsor/admin/driver based on related tables.

    const [result] = await pool.query(
      `INSERT INTO USERS
        (email, password_hash, first_name, last_name, username, title, bio, birthday, status, created_at)
       VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, 'active', NOW())`,
      [
        email,
        hash,
        first_name || null,
        last_name || null,
        username,
        title || null,
        bio || null,
        birthday || null
      ]
    );

    req.session.user = {
      user_id: result.insertId,
      email,
      role: "user",
      name: `${first_name || ""} ${last_name || ""}`.trim()
    };

    res.json({ ok: true, redirect: "/user/dashboard.html" });
  } catch (e) {
    const msg = String(e.message || "").toLowerCase();
    if (msg.includes("duplicate")) {
      // This will trigger if you have UNIQUE constraints on email and/or username
      return res.status(409).json({ error: "Email or username already exists" });
    }
    res.status(500).json({ error: e.message });
  }
});

// Get platform statistics
app.get("/api/about/stats", async (req, res) => {
  try {
    const pool = getPool();

    const [[userCount]] = await pool.query("SELECT COUNT(*) AS count FROM USERS");
    const [[driverCount]] = await pool.query("SELECT COUNT(*) AS count FROM DRIVERS WHERE driver_status = 'active'");
    const [[sponsorCount]] = await pool.query("SELECT COUNT(*) AS count FROM SPONSORUSERS");
    const [[orgCount]] = await pool.query(
      "SELECT COUNT(*) AS count FROM SPONSORORGANIZATION WHERE org_status = 'active'"
    );

    res.json({
      ok: true,
      total_users: Number(userCount.count),
      active_drivers: Number(driverCount.count),
      active_sponsors: Number(sponsorCount.count),
      active_organizations: Number(orgCount.count)
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get team members from database
app.get("/api/about/team", async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      "SELECT team_id, first_name, last_name, role, bio FROM TEAM WHERE is_active = TRUE ORDER BY team_id ASC"
    );
    res.json({ ok: true, team: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/driver/points", requireRole("driver"), async (req, res) => {
  try {
    const pool = getPool();
    const userId = req.session.user.user_id;

    const [rows] = await pool.query("SELECT current_points FROM DRIVERPOINTBALANCES WHERE user_id = ? LIMIT 1", [
      userId
    ]);

    res.json({ ok: true, current_points: rows.length ? Number(rows[0].current_points) : 0 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/driver/total-points", requireRole("driver"), async (req, res) => {
  try {
    const pool = getPool();
    const userId = req.session.user.user_id;
    const [rows] = await pool.query(
      "SELECT SUM(point_change) AS total_points FROM POINTTRANSACTIONS WHERE user_id = ? AND point_change > 0",
      [userId]
    );
    res.json({ ok: true, total_points: rows.length ? Number(rows[0].total_points) : 0 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put("/api/driver/points", requireRole("sponsor", "admin"), async (req, res) => {
  try {
    const pool = getPool();
    const actorUserId = req.session.user.user_id;
    const { user_id, point_change, reason } = req.body;

    // TODO should we verify that this sponsor is actually sponsoring this driver before allowing the update?

    if (typeof point_change !== "number") {
      return res.status(400).json({ error: "Points must be a number" });
    }

    // Get the old points first
    const [rows] = await pool.query("SELECT current_points FROM DRIVERPOINTBALANCES WHERE user_id = ?", [user_id]);

    if (!rows.length) {
      return res.status(404).json({ error: "Driver not found" });
    }

    const oldPoints = rows[0].current_points;

    // Then update
    await pool.query("UPDATE DRIVERPOINTBALANCES SET current_points = ? WHERE user_id = ?", [
      oldPoints + point_change,
      user_id
    ]);

    // Then record the change
    await pool.query(
      "INSERT INTO POINTTRANSACTIONS (user_id, point_change, reason, actor_user_id, transaction_date) VALUES (?, ?, ?, ?, NOW())",
      [user_id, point_change, reason || "None", actorUserId]
    );

    res.json({ ok: true, oldPoints, newPoints: oldPoints + point_change });
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

app.get("/api/sponsor/driver-dollars", requireRole("sponsor"), async (req, res) => {
  try {
    const pool = getPool();
    const userId = req.session.user.user_id;
    const { points } = req.body;
    if (typeof points !== "number") {
      return res.status(400).json({ error: "Points must be a number" });
    }
    // Get the Org Id for the sponsor
    const [orgRows] = await pool.query("SELECT org_id FROM SPONSORUSERS WHERE user_id = ? LIMIT 1", [userId]);
    // If the sponsor is not found, return an error
    if (!orgRows.length) {
      return res.status(404).json({ error: "Sponsor not found" });
    }
    // If the sponsor is found, get the point to cent conversion rate for that org
    const orgId = orgRows[0].org_id;
    const [conversionRows] = await pool.query(
      "SELECT point_to_cent_conversion FROM SPONSORORGANIZATION WHERE org_id = ? LIMIT 1",
      [orgId]
    );
    if (!conversionRows.length) {
      return res.status(404).json({ error: "Conversion rate not found" });
    }
    const conversionRate = conversionRows[0].point_to_cent_conversion;
    const dollars = (points * conversionRate) / 100;
    res.json({ ok: true, dollars: `$${dollars.toFixed(2)}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/sponsor/conversion-rate", requireRole("sponsor"), async (req, res) => {
  try {
    const pool = getPool();
    const userId = req.session.user.user_id;
    const [orgRows] = await pool.query("SELECT org_id FROM SPONSORUSERS WHERE user_id = ? LIMIT 1", [userId]);
    if (!orgRows.length) return res.status(404).json({ error: "Sponsor not found" });
    const [conversionRows] = await pool.query(
      "SELECT point_to_cent_conversion FROM SPONSORORGANIZATION WHERE org_id = ? LIMIT 1",
      [orgRows[0].org_id]
    );
    if (!conversionRows.length) return res.status(404).json({ error: "Conversion rate not found" });
    res.json({ ok: true, conversion_rate: conversionRows[0].point_to_cent_conversion });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/driver/conversion-rate", requireRole("driver"), async (req, res) => {
  try {
    const pool = getPool();
    const userId = req.session.user.user_id;

    // Get the driver's org_id
    const [driverRows] = await pool.query("SELECT org_id FROM DRIVERS WHERE user_id = ? LIMIT 1", [userId]);

    if (!driverRows.length) {
      return res.status(404).json({ error: "Driver not found" });
    }

    const orgId = driverRows[0].org_id;

    // Get conversion rate
    const [conversionRows] = await pool.query(
      "SELECT point_to_cent_conversion FROM SPONSORORGANIZATION WHERE org_id = ? LIMIT 1",
      [orgId]
    );

    if (!conversionRows.length) {
      return res.status(404).json({ error: "Conversion rate not found" });
    }

    res.json({ ok: true, conversion_rate: conversionRows[0].point_to_cent_conversion });
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