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

async function getSponsorOrgId(pool, sponsorUserId) {
  const [rows] = await pool.query(
    "SELECT org_id FROM SPONSORUSERS WHERE user_id = ? LIMIT 1",
    [sponsorUserId]
  );
  return rows.length ? Number(rows[0].org_id) : null;
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

// ---------------------------------
// Role-aware navigation helpers
// ---------------------------------
// Many pages historically linked the logo to /home. Express had no such route,
// resulting in "Cannot GET /home". We now support both /home and /dashboard.
function redirectToRoleDashboard(req, res) {
  const user = req.session.user;
  if (!user) return res.redirect("/");

  if (user.role === "admin") return res.redirect("/admin/dashboard.html");
  if (user.role === "sponsor") return res.redirect("/sponsor/dashboard.html");
  if (user.role === "driver") return res.redirect("/driver/dashboard.html");
  return res.redirect("/user/dashboard.html");
}

app.get("/home", redirectToRoleDashboard);
app.get("/dashboard", redirectToRoleDashboard);

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

// Admin: assume identity as another user (impersonation)
app.post("/api/admin/impersonate", requireRole("admin"), async (req, res) => {
  try {
    const { user_id, as_role } = req.body || {};
    if (!user_id) return res.status(400).json({ error: "user_id required" });

    const pool = getPool();

    // pull target user info
    const [rows] = await pool.query(
      `SELECT user_id, email, first_name, last_name, status
       FROM USERS
       WHERE user_id = ?
       LIMIT 1`,
      [user_id]
    );

    if (!rows.length) return res.status(404).json({ error: "User not found" });
    const target = rows[0];

    // determine the target's actual role
    const targetRole = await getRole(pool, target.user_id);

    // only allow assuming sponsor/driver if that user actually has that role
    if (as_role && as_role !== targetRole) {
      return res.status(400).json({
        error: `User is not a ${as_role}. They are a ${targetRole}.`
      });
    }

    // store original admin so you can "return" later if you want
    if (!req.session.impersonator) {
      req.session.impersonator = { ...req.session.user };
    }

    // replace session user with target
    req.session.user = {
      user_id: target.user_id,
      email: target.email,
      role: targetRole,
      name: `${target.first_name || ""} ${target.last_name || ""}`.trim()
    };

    return res.json({ ok: true, redirect: `/${targetRole}/dashboard.html` });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/driver/points", requireRole("driver"), async (req, res) => {
  try {
    const pool = getPool();
    const userId = req.session.user.user_id;

    // Calculate current balance from all transactions (positive + negative)
    const [rows] = await pool.query(
      "SELECT SUM(point_change) AS current_points FROM POINTTRANSACTIONS WHERE user_id = ?",
      [userId]
    );

    res.json({ ok: true, current_points: (rows.length && rows[0].current_points) ? Number(rows[0].current_points) : 0 });
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

    // Validate point_change is a number
    if (typeof point_change !== "number") {
      return res.status(400).json({ error: "Points must be a number" });
    }

    // Prevent zero transactions
    if (point_change === 0) {
      return res.status(400).json({ error: "Point change cannot be zero" });
    }

    // Validate reason is provided
    if (!reason || reason.trim() === "") {
      return res.status(400).json({ error: "Reason is required for point changes" });
    }

    // Get the old points first
    const [rows] = await pool.query("SELECT current_points FROM DRIVERPOINTBALANCES WHERE user_id = ?", [user_id]);

    if (!rows.length) {
      return res.status(404).json({ error: "Driver not found" });
    }

    const oldPoints = rows[0].current_points;
    const newPoints = oldPoints + point_change;

    // Prevent negative point balance
    if (newPoints < 0) {
      return res.status(400).json({
        error: "Insufficient points. Cannot deduct more points than available.",
        current_points: oldPoints,
        attempted_change: point_change
      });
    }

    // Update points
    await pool.query("UPDATE DRIVERPOINTBALANCES SET current_points = ? WHERE user_id = ?", [newPoints, user_id]);

    // Record the change with reason
    await pool.query(
      "INSERT INTO POINTTRANSACTIONS (user_id, org_id, point_change, reason, actor_user_id) VALUES (?, ?, ?, ?, ?)",
      [user_id, 1, point_change, reason.trim(), actorUserId]
    );

    res.json({ ok: true, oldPoints, newPoints });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/driver/transactions", requireRole("driver"), async (req, res) => {
  try {
    const pool = getPool();
    const userId = req.session.user.user_id;

    const [rows] = await pool.query(
      "SELECT * FROM POINTTRANSACTIONS WHERE user_id = ? ORDER BY created_at DESC LIMIT 25",
      [userId]
    );

    res.json({ ok: true, transactions: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/driver/notifications", requireRole("driver"), async (req, res) => {
  try {
    const pool = getPool();
    const userId = req.session.user.user_id;

    const [rows] = await pool.query(
      `SELECT
         notification_id,
         notification_type,
         message,
         is_read,
         created_at,
         entity_type,
         entity_id
       FROM vw_user_notifications
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT 200`,
      [userId]
    );

    res.json({ ok: true, notifications: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get point history with date range filtering
app.get("/api/driver/point-history-filtered", requireRole("driver"), async (req, res) => {
  try {
    const pool = getPool();
    const userId = req.session.user.user_id;
    const { startDate, endDate } = req.query;

    let query = "SELECT * FROM POINTTRANSACTIONS WHERE user_id = ?";
    const params = [userId];

    // Add date range filtering if provided
    if (startDate) {
      query += " AND created_at >= ?";
      params.push(new Date(startDate));
    }
    if (endDate) {
      query += " AND created_at <= ?";
      params.push(new Date(endDate));
    }

    query += " ORDER BY created_at DESC LIMIT 100";

    const [rows] = await pool.query(query, params);

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
      "SELECT cents_per_point FROM SPONSORORGANIZATION WHERE org_id = ? LIMIT 1",
      [orgId]
    );
    if (!conversionRows.length) {
      return res.status(404).json({ error: "Conversion rate not found" });
    }
    const conversionRate = conversionRows[0].cents_per_point;
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
      "SELECT cents_per_point FROM SPONSORORGANIZATION WHERE org_id = ? LIMIT 1",
      [orgRows[0].org_id]
    );
    if (!conversionRows.length) return res.status(404).json({ error: "Conversion rate not found" });
    res.json({ ok: true, conversion_rate: conversionRows[0].cents_per_point });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/sponsor/driver-balances", requireRole("sponsor"), async (req, res) => {
  try {
    const pool = getPool();
    const sponsorUserId = req.session.user.user_id;

    const orgId = await getSponsorOrgId(pool, sponsorUserId);
    if (!orgId) return res.status(404).json({ error: "Sponsor org not found" });

    const [rows] = await pool.query(
      `SELECT *
       FROM vw_sponsor_driver_point_balances
       WHERE org_id = ?
       ORDER BY last_name, first_name, driver_user_id`,
      [orgId]
    );

    res.json({ ok: true, org_id: orgId, drivers: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/sponsor/driver-point-transactions", requireRole("sponsor"), async (req, res) => {
  try {
    const pool = getPool();
    const sponsorUserId = req.session.user.user_id;

    const orgId = await getSponsorOrgId(pool, sponsorUserId);
    if (!orgId) return res.status(404).json({ error: "Sponsor org not found" });

    const [rows] = await pool.query(
      `SELECT *
       FROM vw_sponsor_driver_point_transactions
       WHERE org_id = ?
       ORDER BY created_at DESC
       LIMIT 200`,
      [orgId]
    );

    res.json({ ok: true, org_id: orgId, transactions: rows });
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
      "SELECT cents_per_point FROM SPONSORORGANIZATION WHERE org_id = ? LIMIT 1",
      [orgId]
    );

    if (!conversionRows.length) {
      return res.status(404).json({ error: "Conversion rate not found" });
    }

    res.json({ ok: true, conversion_rate: conversionRows[0].cents_per_point });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/sponsor/create-driver", requireRole("sponsor"), async (req, res) => {
  try {
    const pool = getPool();
    const sponsorUserId = req.session.user.user_id;
    const { email, first_name, last_name, phone } = req.body;

    // Validate required fields
    if (!email || !email.trim()) {
      return res.status(400).json({ error: "Email is required" });
    }
    if (!first_name || !first_name.trim()) {
      return res.status(400).json({ error: "First name is required" });
    }
    if (!last_name || !last_name.trim()) {
      return res.status(400).json({ error: "Last name is required" });
    }
    if (!phone || !phone.trim()) {
      return res.status(400).json({ error: "Phone number is required" });
    }

    // Get sponsor's org_id
    const [orgRows] = await pool.query(
      "SELECT org_id FROM SPONSORUSERS WHERE user_id = ? LIMIT 1",
      [sponsorUserId]
    );

    if (!orgRows.length) {
      return res.status(404).json({ error: "Sponsor organization not found" });
    }

    const orgId = orgRows[0].org_id;

    // Check if email already exists
    const [existingUser] = await pool.query(
      "SELECT user_id FROM USERS WHERE email = ? LIMIT 1",
      [email.trim()]
    );

    if (existingUser.length) {
      return res.status(409).json({ error: "Email already exists" });
    }

    // Create a temporary password
    const tempPassword = Math.random().toString(36).slice(-8);
    const hash = await bcrypt.hash(tempPassword, 10);

    // Create user
    const [userResult] = await pool.query(
      `INSERT INTO USERS 
       (email, password_hash, first_name, last_name, phone, username, status, notifications_enabled, created_at) 
       VALUES (?, ?, ?, ?, ?, ?, 'active', 1, NOW())`,
      [
        email.trim(),
        hash,
        first_name.trim(),
        last_name.trim(),
        phone.trim(),
        email.trim().split("@")[0] // Use email prefix as username
      ]
    );

    const userId = userResult.insertId;

    // Create driver record
    await pool.query(
      `INSERT INTO DRIVERS 
       (user_id, org_id, phone, driver_status) 
       VALUES (?, ?, ?, 'active')`,
      [userId, orgId, phone.trim()]
    );

    // Initialize point balance
    await pool.query(
      "INSERT INTO DRIVERPOINTBALANCES (user_id, current_points) VALUES (?, 0)",
      [userId]
    );

    res.json({ 
      ok: true, 
      message: "Driver created successfully",
      user_id: userId,
      temp_password: tempPassword,
      email: email.trim()
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put("/api/sponsor/drop-driver", requireRole("sponsor"), async (req, res) => {
  try {
    const pool = getPool();
    const actorUserId = req.session.user.user_id;
    const { driver_user_id } = req.body;

    if (!driver_user_id) {
      return res.status(400).json({ error: "driver_user_id is required" });
    }

    // Get sponsor's org_id
    const [orgRows] = await pool.query(
      "SELECT org_id FROM SPONSORUSERS WHERE user_id = ? LIMIT 1",
      [actorUserId]
    );

    if (!orgRows.length) {
      return res.status(404).json({ error: "Sponsor organization not found" });
    }

    const sponsorOrgId = orgRows[0].org_id;

    // Get driver record
    const [driverRows] = await pool.query(
      "SELECT * FROM DRIVERS WHERE user_id = ? LIMIT 1",
      [driver_user_id]
    );

    if (!driverRows.length) {
      return res.status(404).json({ error: "Driver not found" });
    }

    const driver = driverRows[0];

    // Verify driver belongs to sponsor's organization
    if (driver.org_id !== sponsorOrgId) {
      return res.status(403).json({ error: "You can only drop drivers from your own organization" });
    }

    // Get organization name
    const [orgNameRows] = await pool.query(
      "SELECT org_name FROM SPONSORORGANIZATION WHERE org_id = ? LIMIT 1",
      [sponsorOrgId]
    );

    const orgName = orgNameRows.length ? orgNameRows[0].org_name : "Unknown Organization";

    // Update driver status to inactive
    await pool.query(
      "UPDATE DRIVERS SET driver_status = 'inactive' WHERE user_id = ?",
      [driver_user_id]
    );

    // Clear org affiliation
    await pool.query(
      "UPDATE DRIVERS SET org_id = NULL WHERE user_id = ?",
      [driver_user_id]
    );

    // Audit log the drop event
    await pool.query(
      "INSERT INTO AUDITLOG (action_type, entity_type, entity_id, actor_user_id, details) VALUES (?, ?, ?, ?, ?)",
      ["DROP_DRIVER", "DRIVER", driver_user_id, actorUserId, JSON.stringify({ org_id: sponsorOrgId })]
    );

    // Send notification to dropped driver with org name
    await pool.query(
      "INSERT INTO NOTIFICATIONS (user_id, notification_type, message, entity_type, entity_id) VALUES (?, ?, ?, ?, ?)",
      [driver_user_id, "DRIVER_DROPPED", `You have been dropped from the sponsor organization ${orgName}`, "DRIVER", driver_user_id]
    );

    res.json({ ok: true, message: "Driver dropped successfully" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/sponsor/pending-applications", requireRole("sponsor"), async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT 
        da.application_id,
        da.user_id,
        da.org_id,
        da.application_status,
        da.application_date,
        u.email,
        u.first_name,
        u.last_name
       FROM DRIVERAPPLICATIONS da
       JOIN USERS u ON u.user_id = da.user_id
       WHERE da.application_status = 'PENDING'
       ORDER BY da.application_date DESC
       LIMIT 50`
    );
    res.json({ ok: true, applications: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put("/api/sponsor/reject-application", requireRole("sponsor"), async (req, res) => {
  try {
    const pool = getPool();
    const actorUserId = req.session.user.user_id;
    const { application_id, rejection_reason } = req.body;

    if (!application_id) {
      return res.status(400).json({ error: "application_id is required" });
    }

    if (!rejection_reason || rejection_reason.trim() === "") {
      return res.status(400).json({ error: "rejection_reason is required" });
    }

    // Get the application
    const [appRows] = await pool.query(
      "SELECT * FROM DRIVERAPPLICATIONS WHERE application_id = ? LIMIT 1",
      [application_id]
    );

    if (!appRows.length) {
      return res.status(404).json({ error: "Application not found" });
    }

    const application = appRows[0];

    // Update application status to REJECTED
    await pool.query(
      "UPDATE DRIVERAPPLICATIONS SET application_status = 'REJECTED' WHERE application_id = ?",
      [application_id]
    );

    // Audit log the rejection
    await pool.query(
      "INSERT INTO AUDITLOG (action_type, entity_type, entity_id, actor_user_id, details) VALUES (?, ?, ?, ?, ?)",
      ["REJECT_APPLICATION", "DRIVERAPPLICATION", application_id, actorUserId, JSON.stringify({ rejection_reason })]
    );

    // Send notification to applicant
    await pool.query(
      "INSERT INTO NOTIFICATIONS (user_id, notification_type, message, entity_type, entity_id) VALUES (?, ?, ?, ?, ?)",
      [application.user_id, "APPLICATION_REJECTED", `Your driver application has been rejected. Reason: ${rejection_reason}`, "DRIVERAPPLICATION", application_id]
    );

    res.json({ ok: true, message: "Application rejected successfully" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put("/api/sponsor/approve-application", requireRole("sponsor"), async (req, res) => {
  try {
    const pool = getPool();
    const actorUserId = req.session.user.user_id;
    const { application_id } = req.body;

    if (!application_id) {
      return res.status(400).json({ error: "application_id is required" });
    }

    // Get the application
    const [appRows] = await pool.query(
      "SELECT * FROM DRIVERAPPLICATIONS WHERE application_id = ? LIMIT 1",
      [application_id]
    );

    if (!appRows.length) {
      return res.status(404).json({ error: "Application not found" });
    }

    const application = appRows[0];

    // Update application status to APPROVED
    await pool.query(
      "UPDATE DRIVERAPPLICATIONS SET application_status = 'APPROVED' WHERE application_id = ?",
      [application_id]
    );

    // Audit log the approval
    await pool.query(
      "INSERT INTO AUDITLOG (action_type, entity_type, entity_id, actor_user_id, details) VALUES (?, ?, ?, ?, ?)",
      ["APPROVE_APPLICATION", "DRIVERAPPLICATION", application_id, actorUserId, JSON.stringify({})]
    );

    // Send notification to applicant
    await pool.query(
      "INSERT INTO NOTIFICATIONS (user_id, notification_type, message, entity_type, entity_id) VALUES (?, ?, ?, ?, ?)",
      [application.user_id, "APPLICATION_APPROVED", "Your driver application has been approved!", "DRIVERAPPLICATION", application_id]
    );

    res.json({ ok: true, message: "Application approved successfully" });
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

// Admin: list users (supports ?q= search)
app.get("/api/admin/users", requireRole("admin"), async (req, res) => {
  try {
    const pool = getPool();
    const q = String(req.query.q || "").trim();

    // NOTE: These columns exist in your current app code (profile page + registration).
    // If your DB schema differs, update this SELECT to match.
    const sql = `
      SELECT
        u.user_id,
        u.username,
        u.email,
        u.first_name,
        u.last_name,
        u.status,
        CASE WHEN a.user_id IS NULL THEN 0 ELSE 1 END AS is_admin,
        CASE WHEN su.user_id IS NULL THEN 0 ELSE 1 END AS is_sponsor,
        CASE WHEN d.user_id IS NULL THEN 0 ELSE 1 END AS is_driver
      FROM USERS u
      LEFT JOIN ADMIN a ON a.user_id = u.user_id
      LEFT JOIN SPONSORUSERS su ON su.user_id = u.user_id
      LEFT JOIN DRIVERS d ON d.user_id = u.user_id
      WHERE (
        ? = ''
        OR u.email LIKE CONCAT('%', ?, '%')
        OR u.username LIKE CONCAT('%', ?, '%')
        OR u.first_name LIKE CONCAT('%', ?, '%')
        OR u.last_name LIKE CONCAT('%', ?, '%')
        OR CONCAT(IFNULL(u.first_name,''),' ',IFNULL(u.last_name,'')) LIKE CONCAT('%', ?, '%')
      )
      ORDER BY u.user_id DESC
      LIMIT 250;
    `;

    const [rows] = await pool.query(sql, [q, q, q, q, q, q]);
    res.json({ ok: true, users: rows });
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
        created_at,
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