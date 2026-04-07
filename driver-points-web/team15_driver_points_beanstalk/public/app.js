async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    credentials: "same-origin",
    ...opts
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

async function loadMe() {
  try {
    const { user } = await api("/api/me", { method: "GET" });
    return user;
  } catch {
    return null;
  }
}

function qs(sel) { return document.querySelector(sel); }

function buildAvatarDataUri(label = "U") {
  const safe = String(label || "U").slice(0, 2).toUpperCase();
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#4f8cff"/>
          <stop offset="100%" stop-color="#7c5cff"/>
        </linearGradient>
      </defs>
      <rect width="80" height="80" rx="40" fill="url(#g)"/>
      <text x="50%" y="52%" dominant-baseline="middle" text-anchor="middle" font-family="Arial, sans-serif" font-size="30" font-weight="700" fill="white">${safe}</text>
    </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

/**
 * Adds avatar button + dropdown into a container element (usually .navlinks)
 * Requires: /api/profile returns { profile: { photo_url, username, ... } }
 */
async function mountProfileMenu(containerSelector = ".navlinks") {
  const container = qs(containerSelector);
  if (!container) return;

  const me = await loadMe();
  if (!me) return;

  // Insert dropdown wrapper at the end of navlinks
  const wrap = document.createElement("div");
  wrap.className = "dropdown";
  wrap.innerHTML = `
    <button class="avatarBtn" id="avatarBtn" title="Profile">
      <img id="avatarImg" alt="Profile" src="">
    </button>
    <div class="dropdownMenu" id="ddMenu">
      <div class="muted" id="ddWho">Signed in</div>
      <a href="/profile.html">My Profile</a>
      <button id="ddLogout" type="button">Logout</button>
    </div>
  `;
  container.appendChild(wrap);

  try {
    const { profile } = await api("/api/profile", { method: "GET" });
    const img = wrap.querySelector("#avatarImg");
    const label = profile?.username || me.email || "U";
    img.src = profile?.photo_url || buildAvatarDataUri(label[0]);
    img.onerror = () => { img.src = buildAvatarDataUri(label[0]); };
    wrap.querySelector("#ddWho").textContent = profile?.username
      ? `@${profile.username}`
      : me.email;
  } catch {
    const img = wrap.querySelector("#avatarImg");
    img.src = buildAvatarDataUri((me.email || "U")[0]);
    wrap.querySelector("#ddWho").textContent = me.email;
  }

  // Toggle dropdown
  const btn = wrap.querySelector("#avatarBtn");
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    wrap.classList.toggle("open");
  });

  // Close when clicking outside
  document.addEventListener("click", () => wrap.classList.remove("open"));

  // Logout
  wrap.querySelector("#ddLogout").addEventListener("click", async () => {
    await api("/api/logout", { method: "POST" });
    window.location.href = "/";
  });
}

window.Team15 = { api, loadMe, qs, mountProfileMenu };

/**
 * If admin is impersonating another identity, show a banner and allow "Return to Admin".
 */
async function mountImpersonationBanner() {
  const me = await loadMe();
  if (!me || !me.impersonating) return;

  // Avoid double mount
  if (document.getElementById("impersonationBanner")) return;

  const banner = document.createElement("div");
  banner.id = "impersonationBanner";
  banner.style.position = "sticky";
  banner.style.top = "0";
  banner.style.zIndex = "999";
  banner.style.padding = "10px 14px";
  banner.style.background = "#111";
  banner.style.color = "#fff";
  banner.style.display = "flex";
  banner.style.alignItems = "center";
  banner.style.justifyContent = "space-between";
  banner.style.gap = "12px";
  banner.innerHTML = `
    <div style="font-weight:700">
      You are impersonating a <span style="text-transform:capitalize">${me.role}</span> (user_id ${me.user_id}).
    </div>
    <button class="btn" id="returnToAdminBtn" type="button">Return to Admin</button>
  `;
  document.body.prepend(banner);

  banner.querySelector("#returnToAdminBtn").addEventListener("click", async () => {
    const data = await api("/api/admin/stop-impersonation", { method: "POST" });
    window.location.href = data.redirect || "/admin/dashboard.html";
  });
}

window.Team15.mountImpersonationBanner = mountImpersonationBanner;

document.addEventListener("DOMContentLoaded", () => {
  mountImpersonationBanner().catch(() => {});
});