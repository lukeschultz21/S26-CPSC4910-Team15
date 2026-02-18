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

function requireAnyRole(roles) {
  return (req, res, next) => {
    if (!req.session.user) return res.status(401).json({ error: "Not logged in" });
    if (!roles.includes(req.session.user.role)) return res.status(403).json({ error: "Forbidden" });
    next();
  };
}

async function getRole(pool, userId) {
  const [adminRows] = await pool.query("SELECT 1 FROM ADMIN WHERE user_id = ? LIMIT 1", [userId]);
  if (adminRows.length) return "admin";

  const [sponsorRows] = await pool.query("SELECT 1 FROM SPONSORUSERS WHERE user_id = ? LIMIT 1", [userId]);
  if (sponsorRows.length) return "sponsor";

  const [driverRows] = await pool.query("SELECT 1 FROM DRIVERS WHERE user_id = ? LIMIT 1", [userId]);
  if (driverRows.length) return "driver";

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

    // Get current points
    const [rows] = await pool.query(
      "SELECT current_points FROM DRIVERPOINTBALANCES WHERE user_id = ? LIMIT 1",
      [userId]
    );

    // Get lifetime points (sum of all positive point changes)
    const [lifetimeRows] = await pool.query(
      "SELECT COALESCE(SUM(point_change), 0) AS lifetime_points FROM POINTTRANSACTIONS WHERE user_id = ? AND point_change > 0",
      [userId]
    );

    // Get sponsor's cents_per_point for dollar value calculation
    const [driverRows] = await pool.query(
      "SELECT d.org_id FROM DRIVERS d WHERE d.user_id = ? LIMIT 1",
      [userId]
    );

    let centsPerPoint = 1; // default
    if (driverRows.length && driverRows[0].org_id) {
      const [orgRows] = await pool.query(
        "SELECT cents_per_point FROM SPONSORORGANIZATION WHERE org_id = ? LIMIT 1",
        [driverRows[0].org_id]
      );
      if (orgRows.length) {
        centsPerPoint = orgRows[0].cents_per_point;
      }
    }

    const currentPoints = rows.length ? Number(rows[0].current_points) : 0;
    const lifetimePoints = Number(lifetimeRows[0].lifetime_points);

    res.json({ 
      ok: true, 
      current_points: currentPoints,
      lifetime_points: lifetimePoints,
      cents_per_point: centsPerPoint,
      dollar_value: (currentPoints * centsPerPoint) / 100
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/driver/transactions", requireRole("driver"), async (req, res) => {
  try {
    const pool = getPool();
    const userId = req.session.user.user_id;

    const [rows] = await pool.query(
      `SELECT 
        pt.transaction_id,
        pt.created_at AS transaction_date,
        pt.point_change,
        pt.reason,
        pt.actor_user_id,
        CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')) AS actor_name,
        u.email AS actor_email
      FROM POINTTRANSACTIONS pt
      LEFT JOIN USERS u ON pt.actor_user_id = u.user_id
      WHERE pt.user_id = ? 
      ORDER BY pt.created_at DESC 
      LIMIT 25`,
      [userId]
    );

    res.json({ ok: true, transactions: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/driver/point-history", requireRole("driver"), async (req, res) => {
  try {
    const pool = getPool();
    const userId = req.session.user.user_id;
    const { start_date, end_date, limit = 25 } = req.query;

    let query = `
      SELECT 
        pt.transaction_id,
        pt.created_at AS transaction_date,
        pt.point_change,
        pt.reason,
        pt.actor_user_id,
        CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')) AS actor_name,
        u.email AS actor_email,
        @running_balance := @running_balance + pt.point_change AS balance_after
      FROM POINTTRANSACTIONS pt
      LEFT JOIN USERS u ON pt.actor_user_id = u.user_id
      CROSS JOIN (SELECT @running_balance := 0) vars
      WHERE pt.user_id = ?
    `;

    const params = [userId];

    if (start_date) {
      query += " AND pt.created_at >= ?";
      params.push(start_date);
    }

    if (end_date) {
      query += " AND pt.created_at <= ?";
      params.push(end_date);
    }

    query += " ORDER BY pt.created_at ASC";
    
    if (limit) {
      query += " LIMIT ?";
      params.push(parseInt(limit));
    }

    const [rows] = await pool.query(query, params);

    res.json({ ok: true, history: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/driver/points/add", requireAnyRole(["sponsor", "admin"]), async (req, res) => {
  try {
    const pool = getPool();
    const { driver_id, points_amount, reason } = req.body;
    const actorUserId = req.session.user.user_id;

    // Validate inputs
    if (!driver_id || !points_amount || !reason) {
      return res.status(400).json({ error: "driver_id, points_amount, and reason are required" });
    }

    if (points_amount <= 0) {
      return res.status(400).json({ error: "points_amount must be positive" });
    }

    // Verify driver exists
    const [driverRows] = await pool.query(
      "SELECT user_id, org_id FROM DRIVERS WHERE user_id = ? LIMIT 1",
      [driver_id]
    );

    if (!driverRows.length) {
      return res.status(404).json({ error: "Driver not found" });
    }

    const driver = driverRows[0];

    // Get sponsor's org_id if actor is sponsor
    let orgId = driver.org_id;
    if (req.session.user.role === "sponsor") {
      const [sponsorRows] = await pool.query(
        "SELECT org_id FROM SPONSORUSERS WHERE user_id = ? LIMIT 1",
        [actorUserId]
      );
      if (!sponsorRows.length) {
        return res.status(403).json({ error: "Sponsor not associated with an organization" });
      }
      orgId = sponsorRows[0].org_id;

      // Verify driver belongs to sponsor's org
      if (driver.org_id !== orgId) {
        return res.status(403).json({ error: "Driver does not belong to your organization" });
      }
    }

    // Start transaction
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      // Create point transaction
      await connection.query(
        "INSERT INTO POINTTRANSACTIONS (user_id, org_id, point_change, reason, actor_user_id, created_at) VALUES (?, ?, ?, ?, ?, NOW())",
        [driver_id, orgId, points_amount, reason, actorUserId]
      );

      // Update or insert driver point balance
      await connection.query(
        `INSERT INTO DRIVERPOINTBALANCES (user_id, current_points, updated_at)
         VALUES (?, ?, NOW())
         ON DUPLICATE KEY UPDATE current_points = current_points + ?, updated_at = NOW()`,
        [driver_id, points_amount, points_amount]
      );

      // Create audit log entry
      await connection.query(
        `INSERT INTO AUDITLOG (action_type, actor_user_id, actee_user_id, org_id, success, details, entity_type, entity_id, time_done)
         VALUES ('ADD_POINTS', ?, ?, ?, TRUE, ?, 'DRIVER', ?, NOW())`,
        [actorUserId, driver_id, orgId, JSON.stringify({ points: points_amount, reason }), driver_id]
      );

      // Create notification for driver
      await connection.query(
        `INSERT INTO NOTIFICATIONS (user_id, notification_type, message, created_at)
         VALUES (?, 'POINTS_ADDED', ?, NOW())`,
        [driver_id, `${points_amount} points added: ${reason}`]
      );

      await connection.commit();
      connection.release();

      res.json({ ok: true, message: "Points added successfully", points_added: points_amount });
    } catch (error) {
      await connection.rollback();
      connection.release();
      throw error;
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/driver/points/deduct", requireAnyRole(["sponsor", "admin"]), async (req, res) => {
  try {
    const pool = getPool();
    const { driver_id, points_amount, reason } = req.body;
    const actorUserId = req.session.user.user_id;

    // Validate inputs
    if (!driver_id || !points_amount || !reason) {
      return res.status(400).json({ error: "driver_id, points_amount, and reason are required" });
    }

    if (points_amount <= 0) {
      return res.status(400).json({ error: "points_amount must be positive" });
    }

    // Verify driver exists and get current balance
    const [driverRows] = await pool.query(
      "SELECT d.user_id, d.org_id, COALESCE(dpb.current_points, 0) AS current_points FROM DRIVERS d LEFT JOIN DRIVERPOINTBALANCES dpb ON d.user_id = dpb.user_id WHERE d.user_id = ? LIMIT 1",
      [driver_id]
    );

    if (!driverRows.length) {
      return res.status(404).json({ error: "Driver not found" });
    }

    const driver = driverRows[0];
    const currentPoints = driver.current_points;

    // Check if driver has sufficient points
    if (currentPoints < points_amount) {
      return res.status(400).json({ 
        error: "Insufficient points", 
        current_points: currentPoints, 
        requested: points_amount 
      });
    }

    // Get sponsor's org_id if actor is sponsor
    let orgId = driver.org_id;
    if (req.session.user.role === "sponsor") {
      const [sponsorRows] = await pool.query(
        "SELECT org_id FROM SPONSORUSERS WHERE user_id = ? LIMIT 1",
        [actorUserId]
      );
      if (!sponsorRows.length) {
        return res.status(403).json({ error: "Sponsor not associated with an organization" });
      }
      orgId = sponsorRows[0].org_id;

      // Verify driver belongs to sponsor's org
      if (driver.org_id !== orgId) {
        return res.status(403).json({ error: "Driver does not belong to your organization" });
      }
    }

    // Start transaction
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      // Create point transaction with negative value
      await connection.query(
        "INSERT INTO POINTTRANSACTIONS (user_id, org_id, point_change, reason, actor_user_id, created_at) VALUES (?, ?, ?, ?, ?, NOW())",
        [driver_id, orgId, -points_amount, reason, actorUserId]
      );

      // Update driver point balance
      await connection.query(
        "UPDATE DRIVERPOINTBALANCES SET current_points = current_points - ?, updated_at = NOW() WHERE user_id = ?",
        [points_amount, driver_id]
      );

      // Create audit log entry
      await connection.query(
        `INSERT INTO AUDITLOG (action_type, actor_user_id, actee_user_id, org_id, success, details, entity_type, entity_id, time_done)
         VALUES ('DEDUCT_POINTS', ?, ?, ?, TRUE, ?, 'DRIVER', ?, NOW())`,
        [actorUserId, driver_id, orgId, JSON.stringify({ points: points_amount, reason }), driver_id]
      );

      await connection.commit();
      connection.release();

      res.json({ 
        ok: true, 
        message: "Points deducted successfully", 
        points_deducted: points_amount,
        new_balance: currentPoints - points_amount 
      });
    } catch (error) {
      await connection.rollback();
      connection.release();
      throw error;
    }
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

app.get("/login", (req, res) => res.sendFile(path.join(__dirname, "public", "login.html")));
app.get("/about", (req, res) => res.sendFile(path.join(__dirname, "public", "about.html")));
app.get("/change-password", (req, res) => res.sendFile(path.join(__dirname, "public", "change-password.html")));

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Listening on ${port}`));