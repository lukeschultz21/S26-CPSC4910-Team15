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
      <img id="avatarImg" alt="Profile" src="/default-avatar.png">
    </button>
    <div class="dropdownMenu" id="ddMenu">
      <div class="muted" id="ddWho">Signed in</div>
      <a href="/profile.html">My Profile</a>
      <button id="ddLogout" type="button">Logout</button>
    </div>
  `;
  container.appendChild(wrap);

  // Load profile photo (fallback is default-avatar.png)
  try {
    const { profile } = await api("/api/profile", { method: "GET" });
    const img = wrap.querySelector("#avatarImg");
    if (profile?.photo_url) img.src = profile.photo_url;
    wrap.querySelector("#ddWho").textContent = profile?.username
      ? `@${profile.username}`
      : me.email;
  } catch {
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