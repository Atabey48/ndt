const state = {
  token: null,
  user: null,
  manufacturer: null,
  theme: null,
  documents: [],
  heartbeatTimer: null,
};

const views = {
  login: document.getElementById("login-view"),
  manufacturer: document.getElementById("manufacturer-view"),
  dashboard: document.getElementById("dashboard-view"),
};

const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");

const logoutBtn1 = document.getElementById("logout");
const logoutBtn2 = document.getElementById("logout2");
const backBtn = document.getElementById("back-to-manufacturers");

const manufacturerList = document.getElementById("manufacturer-list");
const dashboardTitle = document.getElementById("dashboard-title");

const documentList = document.getElementById("document-list");
const docSearch = document.getElementById("doc-search");

const tabs = document.querySelectorAll(".tab");
const tabContents = document.querySelectorAll(".tab-content");

const adminTabBtn = document.getElementById("admin-tab-btn");
const activityTabBtn = document.getElementById("activity-tab-btn");
const adminTab = document.getElementById("admin-tab");
const activityTab = document.getElementById("activity-tab");

const uploadForm = document.getElementById("upload-form");
const uploadMessage = document.getElementById("upload-message");

const createUserForm = document.getElementById("create-user-form");
const createUserMsg = document.getElementById("create-user-msg");
const usersTable = document.getElementById("users-table");

const sessionsTable = document.getElementById("sessions-table");
const auditTable = document.getElementById("audit-table");

const API_BASE_URL = ""; // same origin

function showView(name) {
  Object.values(views).forEach((v) => v.classList.remove("active"));
  views[name].classList.add("active");
}

function setTheme(m) {
  document.documentElement.style.setProperty("--primary", m.theme_primary || "#0b3d91");
  document.documentElement.style.setProperty("--secondary", m.theme_secondary || "#dce7f7");
  state.theme = m;
}

async function apiFetch(path, options = {}) {
  const headers = options.headers || {};
  headers["Content-Type"] = headers["Content-Type"] || "application/json";
  if (state.token) headers["Authorization"] = `Bearer ${state.token}`;

  const res = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(payload.error || "Request failed");
  }
  return res.json();
}

async function apiFetchForm(path, formData) {
  const headers = {};
  if (state.token) headers["Authorization"] = `Bearer ${state.token}`;

  const res = await fetch(`${API_BASE_URL}${path}`, { method: "POST", headers, body: formData });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(payload.error || "Request failed");
  }
  return res.json();
}

/* -------------------- heartbeat (duration tracking) -------------------- */

async function heartbeat() {
  if (!state.token) return;
  try {
    await apiFetch("/api/analytics/heartbeat", {
      method: "POST",
      body: JSON.stringify({ path: location.pathname }),
    });
  } catch (_) {
    // ignore
  }
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeat();
  state.heartbeatTimer = setInterval(heartbeat, 15000);
}

function stopHeartbeat() {
  if (state.heartbeatTimer) clearInterval(state.heartbeatTimer);
  state.heartbeatTimer = null;
}

/* -------------------- UI: manufacturers -------------------- */

function renderManufacturers(list) {
  manufacturerList.innerHTML = "";
  list.forEach((m) => {
    const card = document.createElement("button");
    card.className = "document-card";
    card.innerHTML = `<strong>${m.name}</strong><span>Open</span>`;
    card.addEventListener("click", () => selectManufacturer(m));
    manufacturerList.appendChild(card);
  });
}

async function selectManufacturer(m) {
  state.manufacturer = m;
  setTheme(m);
  dashboardTitle.textContent = `${m.name} Documents`;
  await loadDocuments();
  showView("dashboard");

  // Admin-only tabs
  const isAdmin = state.user?.role === "admin";
  adminTabBtn.style.display = isAdmin ? "inline-flex" : "none";
  activityTabBtn.style.display = isAdmin ? "inline-flex" : "none";
  adminTab.style.display = isAdmin ? "block" : "none";
  activityTab.style.display = isAdmin ? "block" : "none";

  if (isAdmin) {
    await refreshAdminPanels();
  } else {
    setTab("documents");
  }
}

/* -------------------- UI: documents -------------------- */

async function loadDocuments() {
  const docs = await apiFetch(`/api/documents?manufacturer_id=${state.manufacturer.id}`);
  state.documents = docs;
  renderDocuments();
}

function renderDocuments() {
  const q = (docSearch.value || "").toLowerCase();
  const docs = state.documents.filter((d) => d.title.toLowerCase().includes(q));

  documentList.innerHTML = "";
  if (docs.length === 0) {
    documentList.innerHTML = `<div class="card"><strong>No documents found</strong><span>Try another search keyword.</span></div>`;
    return;
  }

  docs.forEach((doc) => {
    const card = document.createElement("div");
    card.className = "document-card";
    const date = doc.uploaded_at ? new Date(doc.uploaded_at).toLocaleString() : "";
    card.innerHTML = `
      <strong>${doc.title}</strong>
      <span>Uploaded: ${date}</span>
      <span>Revision: ${doc.revision_date || "-"}</span>
      <span>Tags: ${doc.tags || "-"}</span>
      <span>By: ${doc.uploaded_by || "-"}</span>
      <div class="row">
        <a class="ghost" href="/api/documents/${doc.id}/pdf" target="_blank">Open PDF</a>
      </div>
    `;
    documentList.appendChild(card);
  });
}

docSearch.addEventListener("input", renderDocuments);

/* -------------------- Tabs -------------------- */

function setTab(name) {
  tabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  tabContents.forEach((c) => c.classList.toggle("active", c.dataset.tab === name));
}

tabs.forEach((tab) => {
  tab.addEventListener("click", async () => {
    const name = tab.dataset.tab;
    setTab(name);

    if (name === "admin" && state.user?.role === "admin") await refreshAdminPanels();
    if (name === "activity" && state.user?.role === "admin") await refreshActivityPanels();
  });
});

setTab("documents");

/* -------------------- Admin: create user -------------------- */

createUserForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  createUserMsg.textContent = "";
  const fd = new FormData(createUserForm);

  try {
    await apiFetch("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({
        username: fd.get("new_username"),
        password: fd.get("new_password"),
        role: fd.get("new_role"),
      }),
    });

    createUserMsg.textContent = "User created successfully.";
    createUserForm.reset();
    await refreshUsers();
  } catch (err) {
    createUserMsg.textContent = err.message;
  }
});

async function refreshUsers() {
  const users = await apiFetch("/api/admin/users");
  usersTable.innerHTML = `
    <div class="table-row table-head">
      <div>ID</div><div>Username</div><div>Role</div><div>Active</div><div>Created</div>
    </div>
    ${users
      .map(
        (u) => `
      <div class="table-row">
        <div>${u.id}</div>
        <div>${u.username}</div>
        <div>${u.role}</div>
        <div>${u.is_active ? "yes" : "no"}</div>
        <div>${new Date(u.created_at).toLocaleString()}</div>
      </div>`
      )
      .join("")}
  `;
}

/* -------------------- Admin: upload PDF -------------------- */

uploadForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  uploadMessage.textContent = "";

  try {
    const fd = new FormData(uploadForm);
    fd.append("manufacturer_id", String(state.manufacturer.id));

    await apiFetchForm("/api/admin/documents", fd);

    uploadMessage.textContent = "Upload completed.";
    uploadForm.reset();
    await loadDocuments();
  } catch (err) {
    uploadMessage.textContent = err.message;
  }
});

/* -------------------- Admin: activity -------------------- */

function fmtDuration(seconds) {
  const s = Number(seconds || 0);
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 1) return `${r}s`;
  return `${m}m ${r}s`;
}

async function refreshSessions() {
  const sessions = await apiFetch("/api/admin/sessions?limit=200");

  sessionsTable.innerHTML = `
    <div class="table-row table-head">
      <div>User</div><div>Role</div><div>Start</div><div>Last seen</div><div>Duration</div><div>Last path</div>
    </div>
    ${sessions
      .map(
        (s) => `
      <div class="table-row">
        <div>${s.username}</div>
        <div>${s.role}</div>
        <div>${new Date(s.created_at).toLocaleString()}</div>
        <div>${new Date(s.last_seen_at).toLocaleString()}</div>
        <div>${fmtDuration(s.duration_seconds)}</div>
        <div>${s.last_path || "-"}</div>
      </div>`
      )
      .join("")}
  `;
}

async function refreshAudit() {
  const logs = await apiFetch("/api/admin/audit-logs?limit=200");

  auditTable.innerHTML = `
    <div class="table-row table-head">
      <div>Time</div><div>User</div><div>Action</div><div>Path</div>
    </div>
    ${logs
      .map((l) => {
        const who = l.username || (l.user_id ? `user#${l.user_id}` : "anonymous");
        return `
        <div class="table-row">
          <div>${new Date(l.created_at).toLocaleString()}</div>
          <div>${who}</div>
          <div>${l.action_type}</div>
          <div>${l.path || "-"}</div>
        </div>`;
      })
      .join("")}
  `;
}

async function refreshAdminPanels() {
  await refreshUsers();
}

async function refreshActivityPanels() {
  await refreshSessions();
  await refreshAudit();
}

/* -------------------- Auth flow -------------------- */

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.textContent = "";

  const fd = new FormData(loginForm);
  const username = fd.get("username");
  const password = fd.get("password");

  try {
    const res = await apiFetch("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });

    state.token = res.token;
    state.user = res.user;

    startHeartbeat();

    const manufacturers = await apiFetch("/api/manufacturers");
    renderManufacturers(manufacturers);
    showView("manufacturer");
  } catch (err) {
    loginError.textContent = err.message;
  }
});

async function doLogout() {
  try {
    if (state.token) {
      await apiFetch("/api/auth/logout", { method: "POST", body: JSON.stringify({}) });
    }
  } catch (_) {}
  stopHeartbeat();
  state.token = null;
  state.user = null;
  state.manufacturer = null;
  state.documents = [];
  showView("login");
}

logoutBtn1.addEventListener("click", doLogout);
logoutBtn2.addEventListener("click", doLogout);

backBtn.addEventListener("click", async () => {
  const manufacturers = await apiFetch("/api/manufacturers");
  renderManufacturers(manufacturers);
  showView("manufacturer");
});

/* -------------------- Initial -------------------- */
showView("login");
