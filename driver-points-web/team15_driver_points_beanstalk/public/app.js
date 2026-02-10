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

window.Team15 = { api, loadMe, qs };
