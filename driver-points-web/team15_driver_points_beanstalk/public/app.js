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