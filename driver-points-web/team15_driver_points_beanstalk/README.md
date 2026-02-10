# Team15 Driver Points App (Elastic Beanstalk)

## What this is
A ready-to-deploy Node.js + Express app for:
- Landing page (`/`)
- Login (`/login.html`)
- Register (`/register.html`)
- Role dashboards:
  - Driver: `/driver/dashboard.html`
  - Sponsor: `/sponsor/dashboard.html`
  - Admin: `/admin/dashboard.html`

## Required Beanstalk Environment Variables
Set these in Elastic Beanstalk → Configuration → Software → Environment properties

- DB_HOST
- DB_USER
- DB_PASSWORD
- DB_NAME (Team15_DB)
- DB_PORT (3306)
- SESSION_SECRET (any long random string)

## Quick smoke tests after deploy
- `/health` should return {"ok": true}
- `/dbcheck` should return {"ok": true, "now": ...}
- `/` should load the landing page
- `/login.html` should load the login form

## Important
`USERS.password` must store a **bcrypt hash** (NOT plain text).
Use `scripts/hash_password.js` locally to generate hashes.
