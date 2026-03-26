require("dotenv").config();

const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const path = require("path");
const fs = require("fs");
const https = require("https");
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


// -----------------------------
// eBay catalog helpers
// -----------------------------
const EBAY_ENV = String(process.env.EBAY_ENV || "sandbox").toLowerCase() === "production" ? "production" : "sandbox";
const EBAY_API_HOST = EBAY_ENV === "production" ? "api.ebay.com" : "api.sandbox.ebay.com";
const EBAY_SCOPE = process.env.EBAY_SCOPE || "https://api.ebay.com/oauth/api_scope";
let ebayTokenCache = { accessToken: null, expiresAt: 0 };

function hasEbayConfig() {
  return !!(process.env.EBAY_CLIENT_ID && process.env.EBAY_CLIENT_SECRET);
}

function httpsRequestJson({ method = "GET", hostname, path: requestPath, headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const req = https.request({ method, hostname, path: requestPath, headers }, (res) => {
      let raw = "";
      res.on("data", (chunk) => { raw += chunk; });
      res.on("end", () => {
        let parsed = {};
        try {
          parsed = raw ? JSON.parse(raw) : {};
        } catch (_) {
          parsed = { raw };
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          return resolve(parsed);
        }
        const err = new Error(parsed.message || parsed.error_description || `eBay request failed (${res.statusCode})`);
        err.statusCode = res.statusCode;
        err.payload = parsed;
        reject(err);
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function getEbayAccessToken() {
  if (!hasEbayConfig()) {
    throw new Error("Missing eBay configuration. Set EBAY_CLIENT_ID and EBAY_CLIENT_SECRET in your environment.");
  }

  const now = Date.now();
  if (ebayTokenCache.accessToken && now < ebayTokenCache.expiresAt - 60000) {
    return ebayTokenCache.accessToken;
  }

  const basic = Buffer.from(`${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`).toString("base64");
  const body = `grant_type=client_credentials&scope=${encodeURIComponent(EBAY_SCOPE)}`;

  const tokenData = await httpsRequestJson({
    method: "POST",
    hostname: EBAY_API_HOST,
    path: "/identity/v1/oauth2/token",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": Buffer.byteLength(body)
    },
    body
  });

  ebayTokenCache = {
    accessToken: tokenData.access_token,
    expiresAt: now + (Number(tokenData.expires_in) || 7200) * 1000
  };

  return ebayTokenCache.accessToken;
}

async function ebayApiGet(requestPath) {
  const token = await getEbayAccessToken();
  return httpsRequestJson({
    method: "GET",
    hostname: EBAY_API_HOST,
    path: requestPath,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "X-EBAY-C-MARKETPLACE-ID": process.env.EBAY_MARKETPLACE_ID || "EBAY_US"
    }
  });
}

function normalizeEbayItem(raw, centsPerPoint = 1) {
  const currentPrice = Number(raw?.price?.value || raw?.currentBidPrice?.value || raw?.estimatedAvailabilities?.[0]?.price?.value || 0);
  const currency = raw?.price?.currency || raw?.currentBidPrice?.currency || "USD";
  const availabilityStatus = raw?.availabilityStatus || raw?.estimatedAvailabilities?.[0]?.availabilityStatus || raw?.estimatedAvailabilities?.[0]?.estimatedAvailabilityStatus || "UNKNOWN";
  const imageUrl = raw?.image?.imageUrl || raw?.thumbnailImages?.[0]?.imageUrl || raw?.additionalImages?.[0]?.imageUrl || null;
  const title = raw?.title || raw?.shortDescription || "Untitled Item";
  const itemId = raw?.itemId || raw?.legacyItemId || raw?.epid || null;
  const itemWebUrl = raw?.itemWebUrl || raw?.itemAffiliateWebUrl || null;
  const shortDescription = raw?.shortDescription || raw?.subtitle || raw?.condition || raw?.conditionText || "";
  const pointsCost = centsPerPoint > 0 ? Math.max(1, Math.ceil((currentPrice * 100) / centsPerPoint)) : 0;

  return {
    item_id: itemId,
    title,
    image_url: imageUrl,
    item_web_url: itemWebUrl,
    description: shortDescription,
    condition: raw?.condition || raw?.conditionText || null,
    availability_status: availabilityStatus,
    price_value: currentPrice,
    currency,
    points_cost: pointsCost,
    raw
  };
}

async function ensureCatalogTables(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS SPONSORCATALOGITEMS (
      catalog_item_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      org_id BIGINT UNSIGNED NOT NULL,
      ebay_item_id VARCHAR(255) NOT NULL,
      title VARCHAR(255) NOT NULL,
      image_url TEXT NULL,
      item_web_url TEXT NULL,
      description TEXT NULL,
      condition_text VARCHAR(100) NULL,
      availability_status VARCHAR(100) NULL,
      price_value DECIMAL(10,2) NOT NULL DEFAULT 0,
      currency VARCHAR(12) NOT NULL DEFAULT 'USD',
      last_synced_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_by_user_id BIGINT UNSIGNED NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_org_ebay_item (org_id, ebay_item_id),
      CONSTRAINT fk_catalog_org FOREIGN KEY (org_id) REFERENCES SPONSORORGANIZATION(org_id),
      CONSTRAINT fk_catalog_creator FOREIGN KEY (created_by_user_id) REFERENCES USERS(user_id)
    )
  `);

  const [cols] = await pool.query(`
    SELECT COLUMN_NAME
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'SPONSORCATALOGITEMS'
  `);
  const existing = new Set(cols.map((c) => String(c.COLUMN_NAME).toLowerCase()));

  const alterStatements = [];
  if (!existing.has('item_web_url')) alterStatements.push("ADD COLUMN item_web_url TEXT NULL AFTER image_url");
  if (!existing.has('description')) alterStatements.push("ADD COLUMN description TEXT NULL AFTER item_web_url");
  if (!existing.has('condition_text')) alterStatements.push("ADD COLUMN condition_text VARCHAR(100) NULL AFTER description");
  if (!existing.has('availability_status')) alterStatements.push("ADD COLUMN availability_status VARCHAR(100) NULL AFTER condition_text");
  if (!existing.has('price_value')) alterStatements.push("ADD COLUMN price_value DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER availability_status");
  if (!existing.has('currency')) alterStatements.push("ADD COLUMN currency VARCHAR(12) NOT NULL DEFAULT 'USD' AFTER price_value");
  if (!existing.has('last_synced_at')) alterStatements.push("ADD COLUMN last_synced_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER currency");
  if (!existing.has('created_by_user_id')) alterStatements.push("ADD COLUMN created_by_user_id BIGINT UNSIGNED NULL AFTER last_synced_at");
  if (!existing.has('created_at')) alterStatements.push("ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER created_by_user_id");

  for (const stmt of alterStatements) {
    await pool.query(`ALTER TABLE SPONSORCATALOGITEMS ${stmt}`);
  }

  try {
    await pool.query(`
      ALTER TABLE SPONSORCATALOGITEMS
      ADD UNIQUE KEY uq_org_ebay_item (org_id, ebay_item_id)
    `);
  } catch (_) {
    // already exists
  }
}

async function getOrgCentsPerPoint(pool, orgId) {
  const [rows] = await pool.query(
    "SELECT cents_per_point FROM SPONSORORGANIZATION WHERE org_id = ? LIMIT 1",
    [orgId]
  );
  return rows.length ? Number(rows[0].cents_per_point || 1) : 1;
}

async function getDriverOrgId(pool, userId) {
  const [rows] = await pool.query("SELECT org_id FROM DRIVERS WHERE user_id = ? LIMIT 1", [userId]);
  return rows.length ? Number(rows[0].org_id) : null;
}

async function createNotification(db, userId, notificationType, message, entityType = null, entityId = null) {
  await db.query(
    `INSERT INTO NOTIFICATIONS (user_id, notification_type, message, entity_type, entity_id)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, notificationType, message, entityType, entityId]
  );
}

async function getPurchaseById(pool, purchaseId) {
  const [rows] = await pool.query(
    `SELECT p.purchase_id, p.user_id, p.org_id, p.purchase_status, p.created_at,
            u.email, u.first_name, u.last_name
     FROM PURCHASES p
     JOIN USERS u ON u.user_id = p.user_id
     WHERE p.purchase_id = ?
     LIMIT 1`,
    [purchaseId]
  );
  return rows.length ? rows[0] : null;
}

async function refreshCatalogRows(pool, orgId, rows) {
  const centsPerPoint = await getOrgCentsPerPoint(pool, orgId);
  const refreshed = [];

  for (const row of rows) {
    try {
      const raw = await ebayApiGet(`/buy/browse/v1/item/${encodeURIComponent(row.ebay_item_id)}`);
      const normalized = normalizeEbayItem(raw, centsPerPoint);

      await pool.query(
        `UPDATE SPONSORCATALOGITEMS
         SET title = ?, image_url = ?, item_web_url = ?, description = ?, condition_text = ?,
             availability_status = ?, price_value = ?, currency = ?, last_synced_at = NOW()
         WHERE catalog_item_id = ?`,
        [
          normalized.title,
          normalized.image_url,
          normalized.item_web_url,
          normalized.description,
          normalized.condition,
          normalized.availability_status,
          normalized.price_value,
          normalized.currency,
          row.catalog_item_id
        ]
      );

      refreshed.push({
        ...row,
        ...normalized,
        catalog_item_id: row.catalog_item_id,
        ebay_item_id: row.ebay_item_id,
        last_synced_at: new Date().toISOString()
      });
    } catch (e) {
      refreshed.push({
        ...row,
        item_id: row.ebay_item_id,
        points_cost: centsPerPoint > 0 ? Math.max(1, Math.ceil((Number(row.price_value || 0) * 100) / centsPerPoint)) : 0,
        refresh_error: e.message
      });
    }
  }

  return refreshed;
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
  if (!req.session.user) return res.json({ user: null });

  const user = { ...req.session.user };
  if (req.session.impersonator) {
    user.impersonating = true;
    user.impersonator = {
      user_id: req.session.impersonator.user_id,
      email: req.session.impersonator.email,
      role: req.session.impersonator.role,
      name: req.session.impersonator.name
    };
  }

  res.json({ user });
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

app.post("/api/admin/stop-impersonation", requireAuth, (req, res) => {
  if (!req.session.impersonator) {
    return res.status(400).json({ error: "Not currently impersonating another user" });
  }

  req.session.user = { ...req.session.impersonator };
  delete req.session.impersonator;
  return res.json({ ok: true, redirect: "/admin/dashboard.html" });
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
  const conn = await getPool().getConnection();
  try {
    const actorUserId = req.session.user.user_id;
    const actorRole = req.session.user.role;
    const { user_id, point_change, reason } = req.body;

    if (typeof point_change !== "number" || Number.isNaN(point_change)) {
      return res.status(400).json({ error: "Points must be a number" });
    }
    if (point_change === 0) {
      return res.status(400).json({ error: "Point change cannot be zero" });
    }
    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ error: "Reason is required for point changes" });
    }

    const [[driverRow]] = await conn.query(
      `SELECT d.user_id, d.org_id, COALESCE(b.current_points, 0) AS current_points,
              u.first_name, u.last_name
       FROM DRIVERS d
       JOIN USERS u ON u.user_id = d.user_id
       LEFT JOIN DRIVERPOINTBALANCES b ON b.user_id = d.user_id
       WHERE d.user_id = ?
       LIMIT 1`,
      [user_id]
    );

    if (!driverRow) {
      return res.status(404).json({ error: "Driver not found" });
    }

    if (actorRole === "sponsor") {
      const sponsorOrgId = await getSponsorOrgId(conn, actorUserId);
      if (!sponsorOrgId || Number(driverRow.org_id) !== Number(sponsorOrgId)) {
        return res.status(403).json({ error: "You can only change points for drivers in your organization" });
      }
    }

    const oldPoints = Number(driverRow.current_points || 0);
    const newPoints = oldPoints + Number(point_change);
    if (newPoints < 0) {
      return res.status(400).json({
        error: "Insufficient points. Cannot deduct more points than available.",
        current_points: oldPoints,
        attempted_change: point_change
      });
    }

    await conn.beginTransaction();
    await conn.query(
      `INSERT INTO DRIVERPOINTBALANCES (user_id, current_points)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE current_points = VALUES(current_points)`,
      [user_id, newPoints]
    );
    await conn.query(
      "INSERT INTO POINTTRANSACTIONS (user_id, org_id, point_change, reason, actor_user_id) VALUES (?, ?, ?, ?, ?)",
      [user_id, driverRow.org_id || null, point_change, String(reason).trim(), actorUserId]
    );

    const actionWord = point_change > 0 ? "added" : "deducted";
    const absPoints = Math.abs(Number(point_change));
    await createNotification(
      conn,
      user_id,
      "POINT_CHANGE",
      `${absPoints} points were ${actionWord} to your account. Reason: ${String(reason).trim()}`,
      "POINT_TRANSACTION",
      null
    );

    await conn.commit();
    res.json({ ok: true, oldPoints, newPoints, org_id: driverRow.org_id || null });
  } catch (e) {
    try { await conn.rollback(); } catch (_) {}
    res.status(500).json({ error: e.message });
  } finally {
    conn.release();
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

app.post("/api/driver/notifications/read-all", requireRole("driver"), async (req, res) => {
  try {
    const pool = getPool();
    const userId = req.session.user.user_id;
    await pool.query("UPDATE NOTIFICATIONS SET is_read = 1 WHERE user_id = ?", [userId]);
    res.json({ ok: true });
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

app.get("/api/admin/audit-log", requireRole("admin"), async (req, res) => {
  try {
    const pool = getPool();

    const { startDate, endDate, actionType } = req.query;

    let query = `
      SELECT *
      FROM vw_admin_audit_log
      WHERE 1=1
    `;

    const params = [];

    if (startDate) {
      query += " AND time_done >= ?";
      params.push(new Date(startDate));
    }

    if (endDate) {
      query += " AND time_done <= ?";
      params.push(new Date(endDate));
    }

    if (actionType) {
      query += " AND action_type = ?";
      params.push(actionType);
    }

    query += " ORDER BY time_done DESC LIMIT 200";

    const [rows] = await pool.query(query, params);

    res.json({ ok: true, audit_logs: rows });
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

// ============================================
// Fix pending applications to scope by org
// ============================================
app.get("/api/sponsor/pending-applications", requireRole("sponsor"), async (req, res) => {
  try {
    const pool = getPool();
    const sponsorUserId = req.session.user.user_id;

    // Get sponsor's org_id
    const orgId = await getSponsorOrgId(pool, sponsorUserId);
    if (!orgId) return res.status(404).json({ error: "Sponsor organization not found" });

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
         AND da.org_id = ?
       ORDER BY da.application_date DESC
       LIMIT 50`,
      [orgId]
    );
    res.json({ ok: true, applications: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================
// Guard reject-application endpoint
// ============================================
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

    // Verify sponsor owns this org (authorization check)
    const sponsorOrgId = await getSponsorOrgId(pool, actorUserId);
    if (!sponsorOrgId || Number(sponsorOrgId) !== Number(application.org_id)) {
      return res.status(403).json({ error: "You can only reject applications for your organization" });
    }

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

// ============================================
// Guard approve-application endpoint
// ============================================
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

    // Verify sponsor owns this org (authorization check)
    const sponsorOrgId = await getSponsorOrgId(pool, actorUserId);
    if (!sponsorOrgId || Number(sponsorOrgId) !== Number(application.org_id)) {
      return res.status(403).json({ error: "You can only approve applications for your organization" });
    }

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

// ============================================
// Sponsor notifications API
// ============================================
app.get("/api/sponsor/notifications", requireRole("sponsor"), async (req, res) => {
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

// ============================================
// Driver: Get all my applications/statuses
// ============================================
app.get("/api/driver/application", requireRole("driver"), async (req, res) => {
  try {
    const pool = getPool();
    const userId = req.session.user.user_id;

    const [rows] = await pool.query(
      `SELECT
         da.application_id,
         da.org_id,
         da.application_status,
         da.is_active,
         da.application_date,
         da.decision_reason,
         so.org_name
       FROM DRIVERAPPLICATIONS da
       LEFT JOIN SPONSORORGANIZATION so ON so.org_id = da.org_id
       WHERE da.user_id = ?
       ORDER BY da.application_date DESC, da.application_id DESC`,
      [userId]
    );

    return res.json({ ok: true, applications: rows });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ============================================
// Driver: Submit a new application to a sponsor org
// ============================================
app.post("/api/driver/applications", requireRole("driver"), async (req, res) => {
  try {
    const pool = getPool();
    const userId = req.session.user.user_id;

    const { org_id, message } = req.body || {};
    const orgId = Number(org_id);

    if (!orgId || Number.isNaN(orgId)) {
      return res.status(400).json({ error: "org_id is required" });
    }

    const msg = String(message || "").trim();
    if (msg.length > 225) {
      return res.status(400).json({ error: "Message must be 225 characters or less" });
    }

    // Verify sponsor org exists and is active
    const [orgRows] = await pool.query(
      "SELECT org_id, org_name, org_status FROM SPONSORORGANIZATION WHERE org_id = ? LIMIT 1",
      [orgId]
    );

    if (!orgRows.length) {
      return res.status(404).json({ error: "Sponsor organization not found" });
    }

    if (String(orgRows[0].org_status).toLowerCase() !== "active") {
      return res.status(400).json({ error: "Sponsor organization is not active" });
    }

    // Enforce: do not allow duplicate application to the same sponsor org
    const [existingRows] = await pool.query(
      `SELECT application_id, application_status
       FROM DRIVERAPPLICATIONS
       WHERE user_id = ?
         AND org_id = ?
       LIMIT 1`,
      [userId, orgId]
    );

    if (existingRows.length) {
      return res.status(409).json({
        error: "You have already applied to this sponsor organization."
      });
    }

    // Create application
    const [result] = await pool.query(
      `INSERT INTO DRIVERAPPLICATIONS
        (user_id, org_id, application_status, is_active, application_date, decision_reason)
       VALUES
        (?, ?, 'PENDING', 1, NOW(), ?)`,
      [userId, orgId, msg || null]
    );

    const applicationId = result.insertId;

    // Audit log
    await pool.query(
      `INSERT INTO AUDITLOG
        (action_type, entity_type, entity_id, actor_user_id, details)
       VALUES
        (?, ?, ?, ?, ?)`,
      [
        "SUBMIT_APPLICATION",
        "DRIVERAPPLICATION",
        applicationId,
        userId,
        JSON.stringify({ org_id: orgId })
      ]
    );

    // Notify sponsor users
    const [sponsorUsers] = await pool.query(
      "SELECT user_id FROM SPONSORUSERS WHERE org_id = ?",
      [orgId]
    );

    const orgName = orgRows[0].org_name || "your organization";
    const noteMsg = `A driver submitted a new application for ${orgName}. (application_id: ${applicationId})`;

    for (const su of sponsorUsers) {
      await pool.query(
        `INSERT INTO NOTIFICATIONS
          (user_id, notification_type, message, entity_type, entity_id)
         VALUES
          (?, ?, ?, ?, ?)`,
        [
          su.user_id,
          "APPLICATION_SUBMITTED",
          noteMsg,
          "DRIVERAPPLICATION",
          applicationId
        ]
      );
    }

    return res.json({ ok: true, application_id: applicationId });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// =============================
// Driver: Withdraw application
// =============================
app.put("/api/driver/withdraw-application", requireRole("driver"), async (req, res) => {
  try {
    const pool = getPool();
    const actorUserId = req.session.user.user_id;
    const { application_id } = req.body || {};

    if (!application_id) {
      return res.status(400).json({ error: "application_id is required" });
    }

    // Fetch application
    const [appRows] = await pool.query(
      "SELECT application_id, user_id, org_id, application_status FROM DRIVERAPPLICATIONS WHERE application_id = ? LIMIT 1",
      [application_id]
    );

    if (!appRows.length) {
      return res.status(404).json({ error: "Application not found" });
    }

    const application = appRows[0];

    // Driver can only withdraw their own application
    if (Number(application.user_id) !== Number(actorUserId)) {
      return res.status(403).json({ error: "You can only withdraw your own application" });
    }

    // Only allow withdrawing PENDING apps
    if (String(application.application_status).toUpperCase() !== "PENDING") {
      return res.status(400).json({ error: "Only PENDING applications can be withdrawn" });
    }

    // Mark withdrawn
    await pool.query(
      "UPDATE DRIVERAPPLICATIONS SET application_status = 'REVOKED' WHERE application_id = ?",
      [application_id]
    );

    // Audit log
    await pool.query(
      "INSERT INTO AUDITLOG (action_type, entity_type, entity_id, actor_user_id, details) VALUES (?, ?, ?, ?, ?)",
      ["WITHDRAW_APPLICATION", "DRIVERAPPLICATION", application_id, actorUserId, JSON.stringify({ org_id: application.org_id })]
    );

    // Notify sponsor users for that org
    const [sponsorUsers] = await pool.query(
      "SELECT user_id FROM SPONSORUSERS WHERE org_id = ?",
      [application.org_id]
    );

    // Look up org name (optional, used for message)
    const [orgNameRows] = await pool.query(
      "SELECT org_name FROM SPONSORORGANIZATION WHERE org_id = ? LIMIT 1",
      [application.org_id]
    );
    const orgName = orgNameRows.length ? orgNameRows[0].org_name : "your organization";

    const message = `A driver has withdrawn their pending application for ${orgName}. (application_id: ${application_id})`;

    for (const su of sponsorUsers) {
      await pool.query(
        "INSERT INTO NOTIFICATIONS (user_id, notification_type, message, entity_type, entity_id) VALUES (?, ?, ?, ?, ?)",
        [su.user_id, "APPLICATION_WITHDRAWN", message, "DRIVERAPPLICATION", application_id]
      );
    }

    return res.json({ ok: true, message: "Application withdrawn successfully" });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ============================================
// Driver: Sponsor search/list (by org name)
// ============================================
app.get("/api/driver/sponsors", requireRole("driver"), async (req, res) => {
  try {
    const pool = getPool();
    const q = String(req.query.q || "").trim();

    const sql = `
      SELECT org_id, org_name, org_status
      FROM SPONSORORGANIZATION
      WHERE org_status = 'active'
        AND (? = '' OR org_name LIKE CONCAT('%', ?, '%'))
      ORDER BY org_name ASC
      LIMIT 100
    `;

    const [rows] = await pool.query(sql, [q, q]);
    res.json({ ok: true, sponsors: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// -----------------------------
// eBay catalog routes
// -----------------------------
app.get("/api/ebay/status", requireAuth, async (req, res) => {
  res.json({
    ok: true,
    configured: hasEbayConfig(),
    environment: EBAY_ENV,
    api_host: EBAY_API_HOST
  });
});

app.get("/api/catalog/search", requireRole("sponsor", "admin"), async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const limit = Math.min(25, Math.max(1, Number(req.query.limit || 12)));
    if (!q) return res.status(400).json({ error: "Search query is required" });

    const pool = getPool();
    let orgId = null;
    if (req.session.user.role === "sponsor") {
      orgId = await getSponsorOrgId(pool, req.session.user.user_id);
    } else if (req.query.org_id) {
      orgId = Number(req.query.org_id);
    }
    const centsPerPoint = orgId ? await getOrgCentsPerPoint(pool, orgId) : 1;

    const searchPath = `/buy/browse/v1/item_summary/search?q=${encodeURIComponent(q)}&limit=${limit}`;
    const data = await ebayApiGet(searchPath);
    const items = (data.itemSummaries || []).map((item) => normalizeEbayItem(item, centsPerPoint));
    res.json({ ok: true, environment: EBAY_ENV, items, total: Number(data.total || items.length) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/sponsor/catalog/items", requireRole("sponsor"), async (req, res) => {
  try {
    const pool = getPool();
    await ensureCatalogTables(pool);
    const orgId = await getSponsorOrgId(pool, req.session.user.user_id);
    if (!orgId) return res.status(404).json({ error: "Sponsor org not found" });

    const [rows] = await pool.query(
      `SELECT catalog_item_id, org_id, ebay_item_id, title, image_url, item_web_url, description,
              condition_text, availability_status, price_value, currency, last_synced_at, created_at
       FROM SPONSORCATALOGITEMS
       WHERE org_id = ?
       ORDER BY created_at DESC`,
      [orgId]
    );

    const items = await refreshCatalogRows(pool, orgId, rows);
    res.json({ ok: true, items });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/sponsor/catalog/items", requireRole("sponsor"), async (req, res) => {
  try {
    const { item_id } = req.body || {};
    if (!item_id) return res.status(400).json({ error: "item_id is required" });

    const pool = getPool();
    await ensureCatalogTables(pool);
    const orgId = await getSponsorOrgId(pool, req.session.user.user_id);
    if (!orgId) return res.status(404).json({ error: "Sponsor org not found" });

    const centsPerPoint = await getOrgCentsPerPoint(pool, orgId);
    const raw = await ebayApiGet(`/buy/browse/v1/item/${encodeURIComponent(item_id)}`);
    const item = normalizeEbayItem(raw, centsPerPoint);

    await pool.query(
      `INSERT INTO SPONSORCATALOGITEMS
       (org_id, ebay_item_id, title, image_url, item_web_url, description, condition_text,
        availability_status, price_value, currency, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         title = VALUES(title),
         image_url = VALUES(image_url),
         item_web_url = VALUES(item_web_url),
         description = VALUES(description),
         condition_text = VALUES(condition_text),
         availability_status = VALUES(availability_status),
         price_value = VALUES(price_value),
         currency = VALUES(currency),
         last_synced_at = NOW()`,
      [
        orgId,
        item.item_id,
        item.title,
        item.image_url,
        item.item_web_url,
        item.description,
        item.condition,
        item.availability_status,
        item.price_value,
        item.currency,
        req.session.user.user_id
      ]
    );

    res.json({ ok: true, item });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/sponsor/catalog/items/:catalogItemId", requireRole("sponsor"), async (req, res) => {
  try {
    const pool = getPool();
    await ensureCatalogTables(pool);
    const orgId = await getSponsorOrgId(pool, req.session.user.user_id);
    if (!orgId) return res.status(404).json({ error: "Sponsor org not found" });

    await pool.query(
      "DELETE FROM SPONSORCATALOGITEMS WHERE catalog_item_id = ? AND org_id = ?",
      [req.params.catalogItemId, orgId]
    );

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/driver/catalog", requireRole("driver"), async (req, res) => {
  try {
    const pool = getPool();
    await ensureCatalogTables(pool);
    const orgId = await getDriverOrgId(pool, req.session.user.user_id);
    if (!orgId) return res.status(404).json({ error: "Driver sponsor org not found" });

    const [rows] = await pool.query(
      `SELECT catalog_item_id, org_id, ebay_item_id, title, image_url, item_web_url, description,
              condition_text, availability_status, price_value, currency, last_synced_at, created_at
       FROM SPONSORCATALOGITEMS
       WHERE org_id = ?
       ORDER BY created_at DESC`,
      [orgId]
    );

    const items = await refreshCatalogRows(pool, orgId, rows);
    res.json({ ok: true, items });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/driver/cart", requireRole("driver"), async (req, res) => {
  res.json({ ok: true, items: req.session.cart?.items || [] });
});

app.post("/api/driver/cart/items", requireRole("driver"), async (req, res) => {
  try {
    const { item_id, quantity } = req.body || {};
    const qty = Math.max(1, Number(quantity || 1));
    if (!item_id) return res.status(400).json({ error: "item_id is required" });

    const pool = getPool();
    await ensureCatalogTables(pool);
    const orgId = await getDriverOrgId(pool, req.session.user.user_id);
    if (!orgId) return res.status(404).json({ error: "Driver sponsor org not found" });

    const [catalogRows] = await pool.query(
      "SELECT * FROM SPONSORCATALOGITEMS WHERE org_id = ? AND ebay_item_id = ? LIMIT 1",
      [orgId, item_id]
    );
    if (!catalogRows.length) {
      return res.status(403).json({ error: "Item is not in your sponsor catalog" });
    }

    const centsPerPoint = await getOrgCentsPerPoint(pool, orgId);
    const raw = await ebayApiGet(`/buy/browse/v1/item/${encodeURIComponent(item_id)}`);
    const liveItem = normalizeEbayItem(raw, centsPerPoint);

    if (["OUT_OF_STOCK", "UNAVAILABLE", "SOLD_OUT"].includes(String(liveItem.availability_status || "").toUpperCase())) {
      return res.status(400).json({ error: "Item is currently unavailable" });
    }

    if (!req.session.cart) req.session.cart = { items: [] };
    const existing = req.session.cart.items.find((item) => item.item_id === item_id);
    if (existing) {
      existing.quantity += qty;
      existing.points_cost = liveItem.points_cost;
      existing.price_value = liveItem.price_value;
      existing.availability_status = liveItem.availability_status;
    } else {
      req.session.cart.items.push({ ...liveItem, quantity: qty });
    }

    res.json({ ok: true, items: req.session.cart.items });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put("/api/driver/cart/items/:itemId", requireRole("driver"), async (req, res) => {
  if (!req.session.cart?.items) return res.json({ ok: true, items: [] });
  const qty = Math.max(1, Number(req.body?.quantity || 1));
  req.session.cart.items = req.session.cart.items.map((item) => item.item_id === req.params.itemId ? { ...item, quantity: qty } : item);
  res.json({ ok: true, items: req.session.cart.items });
});

app.delete("/api/driver/cart/items/:itemId", requireRole("driver"), async (req, res) => {
  req.session.cart = req.session.cart || { items: [] };
  req.session.cart.items = (req.session.cart.items || []).filter((item) => item.item_id !== req.params.itemId);
  res.json({ ok: true, items: req.session.cart.items });
});

app.post("/api/driver/cart/checkout", requireRole("driver"), async (req, res) => {
  const conn = await getPool().getConnection();
  try {
    const cartItems = req.session.cart?.items || [];
    if (!cartItems.length) return res.status(400).json({ error: "Your cart is empty" });

    await conn.beginTransaction();

    const userId = req.session.user.user_id;
    const orgId = await getDriverOrgId(conn, userId);
    if (!orgId) {
      await conn.rollback();
      return res.status(404).json({ error: "Driver sponsor org not found" });
    }

    const centsPerPoint = await getOrgCentsPerPoint(conn, orgId);
    let totalPoints = 0;
    const liveItems = [];

    for (const item of cartItems) {
      const [catalogRows] = await conn.query(
        "SELECT 1 FROM SPONSORCATALOGITEMS WHERE org_id = ? AND ebay_item_id = ? LIMIT 1",
        [orgId, item.item_id]
      );
      if (!catalogRows.length) {
        await conn.rollback();
        return res.status(403).json({ error: `Item ${item.title || item.item_id} is no longer in your sponsor catalog` });
      }

      const raw = await ebayApiGet(`/buy/browse/v1/item/${encodeURIComponent(item.item_id)}`);
      const liveItem = normalizeEbayItem(raw, centsPerPoint);
      if (["OUT_OF_STOCK", "UNAVAILABLE", "SOLD_OUT"].includes(String(liveItem.availability_status || "").toUpperCase())) {
        await conn.rollback();
        return res.status(400).json({ error: `${liveItem.title} is currently unavailable` });
      }
      totalPoints += liveItem.points_cost * Number(item.quantity || 1);
      liveItems.push({ ...liveItem, quantity: Number(item.quantity || 1) });
    }

    const [balanceRows] = await conn.query(
      "SELECT current_points FROM DRIVERPOINTBALANCES WHERE user_id = ? LIMIT 1",
      [userId]
    );
    const currentPoints = balanceRows.length ? Number(balanceRows[0].current_points || 0) : 0;
    if (currentPoints < totalPoints) {
      await conn.rollback();
      return res.status(400).json({ error: `Insufficient points. Required ${totalPoints}, available ${currentPoints}.` });
    }

    const [purchaseResult] = await conn.query(
      `INSERT INTO PURCHASES (user_id, org_id, created_by_user_id, purchase_status)
       VALUES (?, ?, ?, 'PENDING')`,
      [userId, orgId, userId]
    );

    for (const item of liveItems) {
      await conn.query(
        `INSERT INTO PURCHASEITEMS (purchase_id, product_id, quantity, product_name, points_cost)
         VALUES (?, ?, ?, ?, ?)`,
        [purchaseResult.insertId, item.item_id, item.quantity, item.title, item.points_cost]
      );
    }

    await conn.query(
      "UPDATE DRIVERPOINTBALANCES SET current_points = current_points - ? WHERE user_id = ?",
      [totalPoints, userId]
    );

    await conn.query(
      `INSERT INTO POINTTRANSACTIONS (user_id, org_id, point_change, reason, actor_user_id)
       VALUES (?, ?, ?, ?, ?)`,
      [userId, orgId, -totalPoints, `Purchase redemption #${purchaseResult.insertId}`, userId]
    );

    await createNotification(
      conn,
      userId,
      "ORDER_PLACED",
      `Order #${purchaseResult.insertId} placed successfully and is now pending review. Total points used: ${totalPoints}.`,
      "PURCHASE",
      purchaseResult.insertId
    );

    await conn.commit();
    req.session.cart = { items: [] };
    res.json({ ok: true, purchase_id: purchaseResult.insertId, total_points: totalPoints, purchase_status: 'PENDING' });
  } catch (e) {
    try {
      await conn.rollback();
    } catch (_) {
      // ignore rollback errors
    }
    res.status(500).json({ error: e.message });
  } finally {
    conn.release();
  }
});

app.get("/api/driver/purchases", requireRole("driver"), async (req, res) => {
  try {
    const pool = getPool();
    const userId = req.session.user.user_id;
    const [rows] = await pool.query(
      `SELECT p.purchase_id, p.purchase_status, p.confirmed_at, p.created_at,
              COALESCE(SUM(pi.points_cost * pi.quantity), 0) AS total_points,
              COUNT(pi.purchase_item_id) AS item_count
       FROM PURCHASES p
       LEFT JOIN PURCHASEITEMS pi ON pi.purchase_id = p.purchase_id
       WHERE p.user_id = ?
       GROUP BY p.purchase_id, p.purchase_status, p.confirmed_at, p.created_at
       ORDER BY p.created_at DESC
       LIMIT 50`,
      [userId]
    );
    res.json({ ok: true, purchases: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

async function listPurchasesForRole(pool, role, actorUserId) {
  let sql = `SELECT p.purchase_id, p.purchase_status, p.created_at, p.confirmed_at,
                    p.user_id, p.org_id, u.email, u.first_name, u.last_name,
                    COALESCE(SUM(pi.points_cost * pi.quantity), 0) AS total_points,
                    COUNT(pi.purchase_item_id) AS item_count
             FROM PURCHASES p
             JOIN USERS u ON u.user_id = p.user_id
             LEFT JOIN PURCHASEITEMS pi ON pi.purchase_id = p.purchase_id`;
  const params = [];
  if (role === 'sponsor') {
    const sponsorOrgId = await getSponsorOrgId(pool, actorUserId);
    sql += ` WHERE p.org_id = ?`;
    params.push(sponsorOrgId || 0);
  }
  sql += ` GROUP BY p.purchase_id, p.purchase_status, p.created_at, p.confirmed_at, p.user_id, p.org_id, u.email, u.first_name, u.last_name
           ORDER BY p.created_at DESC
           LIMIT 200`;
  const [rows] = await pool.query(sql, params);
  return rows;
}

async function updatePurchaseStatus(conn, purchaseId, nextStatus, actorUserId, actorRole) {
  const allowed = new Set(['PENDING', 'PROCESSING', 'COMPLETED', 'CANCELLED']);
  const normalizedStatus = String(nextStatus || '').toUpperCase();
  if (!allowed.has(normalizedStatus)) {
    const err = new Error('Invalid purchase status');
    err.statusCode = 400;
    throw err;
  }

  const purchase = await getPurchaseById(conn, purchaseId);
  if (!purchase) {
    const err = new Error('Purchase not found');
    err.statusCode = 404;
    throw err;
  }

  if (actorRole === 'sponsor') {
    const sponsorOrgId = await getSponsorOrgId(conn, actorUserId);
    if (!sponsorOrgId || Number(sponsorOrgId) !== Number(purchase.org_id)) {
      const err = new Error('Forbidden');
      err.statusCode = 403;
      throw err;
    }
  }

  const currentStatus = String(purchase.purchase_status || '').toUpperCase();
  if (currentStatus === normalizedStatus) {
    return { purchase, refunded: false };
  }
  if (currentStatus === 'CANCELLED') {
    const err = new Error('Cancelled purchases cannot be changed again');
    err.statusCode = 400;
    throw err;
  }

  const [sumRows] = await conn.query(
    `SELECT COALESCE(SUM(points_cost * quantity), 0) AS total_points
     FROM PURCHASEITEMS
     WHERE purchase_id = ?`,
    [purchaseId]
  );
  const totalPoints = Number(sumRows[0]?.total_points || 0);

  await conn.query(
    `UPDATE PURCHASES
     SET purchase_status = ?, confirmed_at = CASE WHEN ? = 'COMPLETED' THEN NOW() ELSE confirmed_at END,
         updated_at = NOW()
     WHERE purchase_id = ?`,
    [normalizedStatus, normalizedStatus, purchaseId]
  );

  let refunded = false;
  if (normalizedStatus === 'CANCELLED' && currentStatus !== 'CANCELLED' && totalPoints > 0) {
    await conn.query(
      `UPDATE DRIVERPOINTBALANCES
       SET current_points = current_points + ?
       WHERE user_id = ?`,
      [totalPoints, purchase.user_id]
    );
    await conn.query(
      `INSERT INTO POINTTRANSACTIONS (user_id, org_id, point_change, reason, actor_user_id)
       VALUES (?, ?, ?, ?, ?)`,
      [purchase.user_id, purchase.org_id, totalPoints, `Refund for cancelled purchase #${purchaseId}`, actorUserId]
    );
    refunded = true;
  }

  const messageMap = {
    PENDING: `Order #${purchaseId} is pending review.`,
    PROCESSING: `Order #${purchaseId} is being processed.`,
    COMPLETED: `Order #${purchaseId} has been completed.`,
    CANCELLED: refunded
      ? `Order #${purchaseId} was cancelled. ${totalPoints} points were refunded to your account.`
      : `Order #${purchaseId} was cancelled.`
  };
  await createNotification(conn, purchase.user_id, 'PURCHASE_STATUS', messageMap[normalizedStatus], 'PURCHASE', purchaseId);

  return { purchase: { ...purchase, purchase_status: normalizedStatus }, refunded, totalPoints };
}

app.get('/api/sponsor/purchases', requireRole('sponsor'), async (req, res) => {
  try {
    const rows = await listPurchasesForRole(getPool(), 'sponsor', req.session.user.user_id);
    res.json({ ok: true, purchases: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/sponsor/purchases/:purchaseId/status', requireRole('sponsor'), async (req, res) => {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const result = await updatePurchaseStatus(conn, req.params.purchaseId, req.body.purchase_status, req.session.user.user_id, 'sponsor');
    await conn.commit();
    res.json({ ok: true, purchase: result.purchase, refunded: result.refunded, total_points: result.totalPoints || 0 });
  } catch (e) {
    try { await conn.rollback(); } catch (_) {}
    res.status(e.statusCode || 500).json({ error: e.message });
  } finally {
    conn.release();
  }
});

app.get('/api/admin/purchases', requireRole('admin'), async (req, res) => {
  try {
    const rows = await listPurchasesForRole(getPool(), 'admin', req.session.user.user_id);
    res.json({ ok: true, purchases: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/admin/purchases/:purchaseId/status', requireRole('admin'), async (req, res) => {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const result = await updatePurchaseStatus(conn, req.params.purchaseId, req.body.purchase_status, req.session.user.user_id, 'admin');
    await conn.commit();
    res.json({ ok: true, purchase: result.purchase, refunded: result.refunded, total_points: result.totalPoints || 0 });
  } catch (e) {
    try { await conn.rollback(); } catch (_) {}
    res.status(e.statusCode || 500).json({ error: e.message });
  } finally {
    conn.release();
  }
});

app.get("/api/driver/purchases", requireRole("driver"), async (req, res) => {
  try {
    const pool = getPool();
    const userId = req.session.user.user_id;
    const [rows] = await pool.query(
      `SELECT purchase_id, purchase_status, confirmed_at, created_at
       FROM PURCHASES
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT 50`,
      [userId]
    );
    res.json({ ok: true, purchases: rows });
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


// ============================================================
// REPORTING ENDPOINTS (READ-ONLY)
// ============================================================
app.get("/api/admin/reports/users-by-role", requireRole("admin"), async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(`
      SELECT role, COUNT(*) AS user_count
      FROM (
        SELECT 'admin' AS role, a.user_id FROM ADMIN a
        UNION ALL
        SELECT 'sponsor' AS role, su.user_id FROM SPONSORUSERS su
        UNION ALL
        SELECT 'driver' AS role, d.user_id FROM DRIVERS d
        UNION ALL
        SELECT 'user' AS role, u.user_id
        FROM USERS u
        LEFT JOIN ADMIN a ON a.user_id = u.user_id
        LEFT JOIN SPONSORUSERS su ON su.user_id = u.user_id
        LEFT JOIN DRIVERS d ON d.user_id = u.user_id
        WHERE a.user_id IS NULL AND su.user_id IS NULL AND d.user_id IS NULL
      ) roles
      GROUP BY role
      ORDER BY FIELD(role, 'admin', 'sponsor', 'driver', 'user');
    `);
    res.json({ ok: true, rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/admin/reports/drivers", requireRole("admin"), async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(`
      SELECT
        d.user_id AS driver_user_id,
        u.email AS driver_email,
        u.first_name,
        u.last_name,
        d.driver_status,
        d.org_id,
        so.org_name,
        COALESCE(dpb.current_points, 0) AS current_points,
        dpb.updated_at AS balance_updated_at
      FROM DRIVERS d
      JOIN USERS u ON u.user_id = d.user_id
      LEFT JOIN SPONSORORGANIZATION so ON so.org_id = d.org_id
      LEFT JOIN DRIVERPOINTBALANCES dpb ON dpb.user_id = d.user_id
      ORDER BY u.last_name, u.first_name, d.user_id;
    `);
    res.json({ ok: true, rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/admin/reports/points", requireRole("admin"), async (req, res) => {
  try {
    const pool = getPool();
    const [balances] = await pool.query(`
      SELECT
        d.user_id AS driver_user_id,
        u.email AS driver_email,
        CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')) AS driver_name,
        d.org_id,
        so.org_name,
        COALESCE(dpb.current_points, 0) AS current_points,
        dpb.updated_at AS balance_updated_at
      FROM DRIVERS d
      JOIN USERS u ON u.user_id = d.user_id
      LEFT JOIN SPONSORORGANIZATION so ON so.org_id = d.org_id
      LEFT JOIN DRIVERPOINTBALANCES dpb ON dpb.user_id = d.user_id
      ORDER BY current_points DESC, d.user_id ASC;
    `);

    const [totals] = await pool.query(`
      SELECT
        so.org_id,
        so.org_name,
        COALESCE(SUM(CASE WHEN pt.point_change > 0 THEN pt.point_change ELSE 0 END), 0) AS points_awarded,
        COALESCE(SUM(CASE WHEN pt.point_change < 0 THEN ABS(pt.point_change) ELSE 0 END), 0) AS points_redeemed,
        COALESCE(SUM(COALESCE(dpb.current_points, 0)), 0) AS current_points_held
      FROM SPONSORORGANIZATION so
      LEFT JOIN POINTTRANSACTIONS pt ON pt.org_id = so.org_id
      LEFT JOIN DRIVERS d ON d.org_id = so.org_id
      LEFT JOIN DRIVERPOINTBALANCES dpb ON dpb.user_id = d.user_id
      GROUP BY so.org_id, so.org_name
      ORDER BY so.org_name;
    `);

    res.json({ ok: true, balances, totals });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/admin/reports/sales-by-sponsor", requireRole("admin"), async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(`
      SELECT
        so.org_id,
        so.org_name,
        COUNT(DISTINCT p.purchase_id) AS purchase_count,
        COALESCE(SUM(pi.quantity), 0) AS total_items,
        COALESCE(SUM(pi.points_cost), 0) AS total_points_spent
      FROM SPONSORORGANIZATION so
      LEFT JOIN PURCHASES p ON p.org_id = so.org_id
      LEFT JOIN PURCHASEITEMS pi ON pi.purchase_id = p.purchase_id
      GROUP BY so.org_id, so.org_name
      ORDER BY total_points_spent DESC, so.org_name ASC;
    `);
    res.json({ ok: true, rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/admin/reports/sales-by-driver", requireRole("admin"), async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(`
      SELECT
        p.user_id AS driver_user_id,
        u.email AS driver_email,
        u.first_name,
        u.last_name,
        p.org_id,
        so.org_name,
        COUNT(DISTINCT p.purchase_id) AS purchase_count,
        COALESCE(SUM(pi.quantity), 0) AS total_items,
        COALESCE(SUM(pi.points_cost), 0) AS total_points_spent
      FROM PURCHASES p
      JOIN USERS u ON u.user_id = p.user_id
      LEFT JOIN SPONSORORGANIZATION so ON so.org_id = p.org_id
      LEFT JOIN PURCHASEITEMS pi ON pi.purchase_id = p.purchase_id
      GROUP BY p.user_id, u.email, u.first_name, u.last_name, p.org_id, so.org_name
      ORDER BY total_points_spent DESC, p.user_id ASC;
    `);
    res.json({ ok: true, rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/admin/reports/audit-log", requireRole("admin"), async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(`
      SELECT
        action_type,
        entity_type,
        COUNT(*) AS event_count,
        MAX(time_done) AS latest_event
      FROM AUDITLOG
      GROUP BY action_type, entity_type
      ORDER BY latest_event DESC, event_count DESC;
    `);
    res.json({ ok: true, rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/sponsor/reports/top-drivers", requireRole("sponsor"), async (req, res) => {
  try {
    const pool = getPool();
    const orgId = await getSponsorOrgId(pool, req.session.user.user_id);
    if (!orgId) return res.status(404).json({ error: "Sponsor organization not found" });
    const [rows] = await pool.query(`
      SELECT
        driver_user_id,
        driver_email,
        first_name,
        last_name,
        driver_status,
        points_earned_total,
        points_redeemed_total,
        net_points
      FROM vw_sponsor_top_drivers_by_points_earned
      WHERE org_id = ?
      ORDER BY net_points DESC, points_earned_total DESC, driver_user_id ASC;
    `, [orgId]);
    res.json({ ok: true, rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/sponsor/reports/purchase-summary", requireRole("sponsor"), async (req, res) => {
  try {
    const pool = getPool();
    const orgId = await getSponsorOrgId(pool, req.session.user.user_id);
    if (!orgId) return res.status(404).json({ error: "Sponsor organization not found" });
    const [rows] = await pool.query(`
      SELECT
        p.purchase_id,
        p.user_id AS driver_user_id,
        u.email AS driver_email,
        u.first_name,
        u.last_name,
        p.purchase_status,
        p.created_by_user_id,
        p.created_at,
        p.updated_at,
        COALESCE(SUM(pi.quantity), 0) AS total_items,
        COALESCE(SUM(pi.points_cost), 0) AS total_points_spent
      FROM PURCHASES p
      JOIN USERS u ON u.user_id = p.user_id
      LEFT JOIN PURCHASEITEMS pi ON pi.purchase_id = p.purchase_id
      WHERE p.org_id = ?
      GROUP BY p.purchase_id, p.user_id, u.email, u.first_name, u.last_name, p.purchase_status, p.created_by_user_id, p.created_at, p.updated_at
      ORDER BY p.created_at DESC, p.purchase_id DESC;
    `, [orgId]);
    res.json({ ok: true, rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/sponsor/reports/invoice-summary", requireRole("sponsor"), async (req, res) => {
  try {
    const pool = getPool();
    const orgId = await getSponsorOrgId(pool, req.session.user.user_id);
    if (!orgId) return res.status(404).json({ error: "Sponsor organization not found" });
    const [rows] = await pool.query(`
      SELECT
        so.org_id,
        so.org_name,
        COUNT(DISTINCT p.purchase_id) AS purchase_count,
        COALESCE(SUM(pi.quantity), 0) AS total_items,
        COALESCE(SUM(pi.points_cost), 0) AS total_points_redeemed,
        COALESCE(SUM(CASE WHEN p.purchase_status = 'CANCELLED' THEN pi.points_cost ELSE 0 END), 0) AS cancelled_points,
        COALESCE(SUM(CASE WHEN p.purchase_status <> 'CANCELLED' THEN pi.points_cost ELSE 0 END), 0) AS net_points_redeemed
      FROM SPONSORORGANIZATION so
      LEFT JOIN PURCHASES p ON p.org_id = so.org_id
      LEFT JOIN PURCHASEITEMS pi ON pi.purchase_id = p.purchase_id
      WHERE so.org_id = ?
      GROUP BY so.org_id, so.org_name;
    `, [orgId]);
    res.json({ ok: true, rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


app.get("/login", (req, res) => res.sendFile(path.join(__dirname, "public", "login.html")));
app.get("/about", (req, res) => res.sendFile(path.join(__dirname, "public", "about.html")));
app.get("/change-password", (req, res) => res.sendFile(path.join(__dirname, "public", "change-password.html")));

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Listening on ${port}`));