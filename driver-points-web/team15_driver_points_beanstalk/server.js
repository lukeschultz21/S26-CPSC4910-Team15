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
      "SELECT user_id, email, password, status, first_name, last_name FROM USERS WHERE email = ? LIMIT 1",
      [email]
    );

    if (!rows.length) return res.status(401).json({ error: "Invalid credentials" });

    const user = rows[0];

    if (user.status && String(user.status).toLowerCase() !== "active") {
      return res.status(403).json({ error: "Account not active" });
    }

    const ok = await bcrypt.compare(password, user.password);
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

app.post("/api/register", async (req, res) => {
  try {
    const { email, password, first_name, last_name } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email and password required" });

    const pool = getPool();
    const hash = await bcrypt.hash(password, 10);

    const [result] = await pool.query(
      "INSERT INTO USERS (email, password, first_name, last_name, status, created_at) VALUES (?, ?, ?, ?, 'active', NOW())",
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

app.get("/login", (req, res) => res.sendFile(path.join(__dirname, "public", "login.html")));

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Listening on ${port}`));
