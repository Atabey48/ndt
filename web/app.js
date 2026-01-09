const state = {
  token: null,
  user: null,
  manufacturer: null,
  theme: null,
};

const views = {
  login: document.getElementById("login-view"),
  manufacturer: document.getElementById("manufacturer-view"),
  dashboard: document.getElementById("dashboard-view"),
};

const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");

const backToLoginBtn = document.getElementById("back-to-login");
const backToManufacturersBtn = document.getElementById("back-to-manufacturers");
const logoutBtn1 = document.getElementById("logout");
const logoutBtn2 = document.getElementById("logout-2");

const manufacturerList = document.getElementById("manufacturer-list");
const documentList = document.getElementById("document-list");
const detailPanel = document.getElementById("detail-panel");
const dashboardTitle = document.getElementById("dashboard-title");
const whoami = document.getElementById("whoami");

const uploadForm = document.getElementById("upload-form");
const uploadMessage = document.getElementById("upload-message");

const toolQuery = document.getElementById("tool-query");
const toolSearch = document.getElementById("tool-search");
const toolResults = document.getElementById("tool-results");

const createUserForm = document.getElementById("create-user-form");
const createUserMessage = document.getElementById("create-user-message");
const usersList = document.getElementById("users-list");

const activityList = document.getElementById("activity-list");

const tabs = document.querySelectorAll(".tab");
const tabContents = document.querySelectorAll(".tab-content");

const API_BASE_URL = ""; // same origin

const apiFetch = async (path, options = {}) => {
  const headers = options.headers || {};
  if (state.token) headers.Authorization = `Bearer ${state.token}`;

  const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const msg = payload?.error || payload?.detail || "Request failed";
    throw new Error(msg);
  }

  return payload;
};

const showView = (name) => {
  Object.values(views).forEach((v) => v.classList.remove("active"));
  views[name].classList.add("active");
};

const setTheme = (manufacturer) => {
  document.documentElement.style.setProperty("--primary", manufacturer.theme_primary || "#0033A1");
  document.documentElement.style.setProperty("--secondary", manufacturer.theme_secondary || "#DCE7F7");
  state.theme = manufacturer;
};

const setTab = (name) => {
  tabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  tabContents.forEach((c) => c.classList.toggle("active", c.dataset.tab === name));
};

tabs.forEach((tab) => tab.addEventListener("click", () => setTab(tab.dataset.tab)));

const refreshAdminVisibility = () => {
  const adminOnlyTabs = document.querySelectorAll(".admin-only");
  const isAdmin = state.user?.role === "admin";
  adminOnlyTabs.forEach((el) => (el.style.display = isAdmin ? "inline-flex" : "none"));
};

const renderManufacturers = (manufacturers) => {
  manufacturerList.innerHTML = "";
  manufacturers.forEach((m) => {
    const card = document.createElement("button");
    card.className = "document-card";
    card.innerHTML = `<strong>${m.name}</strong>`;
    card.addEventListener("click", () => selectManufacturer(m));
    manufacturerList.appendChild(card);
  });
};

const selectManufacturer = async (manufacturer) => {
  state.manufacturer = manufacturer;
  setTheme(manufacturer);
  dashboardTitle.textContent = `${manufacturer.name} Documents`;
  detailPanel.innerHTML = `<div class="hint">Select a document from the menu.</div>`;
  await loadDocuments();
  showView("dashboard");
  setTab("docs");
};

const loadDocuments = async () => {
  const docs = await apiFetch(`/api/documents?manufacturer_id=${state.manufacturer.id}`);
  renderDocuments(docs);
};

const renderDocuments = (docs) => {
  documentList.innerHTML = "";
  if (!docs.length) {
    const empty = document.createElement("div");
    empty.className = "card";
    empty.innerHTML = `<strong>No documents yet</strong><span>Admin can add documents from Admin tab.</span>`;
    documentList.appendChild(empty);
    return;
  }

  docs.forEach((doc) => {
    const item = document.createElement("button");
    item.className = "menu-item";
    item.innerHTML = `<strong>${doc.title}</strong>`;
    item.addEventListener("click", () => loadDocumentDetail(doc.id));
    documentList.appendChild(item);
  });
};

const loadDocumentDetail = async (docId) => {
  const detail = await apiFetch(`/api/documents/${docId}`);

  const sections = detail.sections || [];
  const figures = detail.figures || [];

  const pdfLink = detail.pdf_url
    ? `<a class="ghost" href="${detail.pdf_url}" target="_blank" rel="noreferrer">Open PDF</a>`
    : `<span class="hint">No PDF URL</span>`;

  const meta = `
    <div class="meta">
      <div><strong>Title:</strong> ${detail.title}</div>
      <div><strong>Revision:</strong> ${detail.revision_date || "-"}</div>
      <div><strong>Tags:</strong> ${detail.tags || "-"}</div>
      <div>${pdfLink}</div>
    </div>
  `;

  const sectionsHtml = sections.length
    ? sections
        .map(
          (s) => `
            <div class="card">
              <strong>${escapeHtml(s.heading_text)}</strong>
              <span>Pages: ${s.page_start ?? "?"} - ${s.page_end ?? "?"}</span>
            </div>
          `
        )
        .join("")
    : `<div class="card"><strong>No sections</strong><span>Add sections during upload (Admin).</span></div>`;

  const figuresHtml = figures.length
    ? figures
        .map(
          (f) => `
            <div class="card">
              <strong>${escapeHtml(f.caption_text || "Figure")}</strong>
              <span>Page: ${f.page_number ?? "?"}</span>
            </div>
          `
        )
        .join("")
    : `<div class="card"><strong>No figures</strong><span>Add figures during upload (Admin).</span></div>`;

  detailPanel.innerHTML = `
    ${meta}
    <div class="divider"></div>
    <h4>Sections</h4>
    <div class="list">${sectionsHtml}</div>
    <div class="divider"></div>
    <h4>Figures</h4>
    <div class="list">${figuresHtml}</div>
  `;
};

const parseSectionsText = (text) => {
  // Format: Heading|pageStart|pageEnd
  const lines = (text || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  return lines.map((line) => {
    const [heading, ps, pe] = line.split("|").map((x) => (x ?? "").trim());
    return {
      heading_text: heading,
      page_start: ps ? Number(ps) : undefined,
      page_end: pe ? Number(pe) : undefined,
    };
  });
};

const parseFiguresText = (text) => {
  // Format: Caption|pageNumber
  const lines = (text || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  return lines.map((line) => {
    const [caption, page] = line.split("|").map((x) => (x ?? "").trim());
    return {
      caption_text: caption,
      page_number: page ? Number(page) : undefined,
    };
  });
};

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.textContent = "";

  const fd = new FormData(loginForm);
  const username = String(fd.get("username") || "").trim();
  const password = String(fd.get("password") || "").trim();

  try {
    const res = await apiFetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    state.token = res.token;
    state.user = res.user;

    whoami.textContent = `Signed in as ${state.user.username} (${state.user.role})`;
    refreshAdminVisibility();

    const manufacturers = await apiFetch("/api/manufacturers");
    renderManufacturers(manufacturers);
    showView("manufacturer");
  } catch (err) {
    loginError.textContent = err.message;
  }
});

const logout = async () => {
  try {
    if (state.token) {
      await apiFetch("/api/auth/logout", { method: "POST" });
    }
  } catch {
    // ignore
  }
  state.token = null;
  state.user = null;
  state.manufacturer = null;
  whoami.textContent = "";
  showView("login");
};

logoutBtn1.addEventListener("click", logout);
logoutBtn2.addEventListener("click", logout);

backToLoginBtn.addEventListener("click", () => showView("login"));
backToManufacturersBtn.addEventListener("click", async () => {
  const manufacturers = await apiFetch("/api/manufacturers");
  renderManufacturers(manufacturers);
  showView("manufacturer");
});

uploadForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  uploadMessage.textContent = "";

  const fd = new FormData(uploadForm);
  const title = String(fd.get("title") || "").trim();

  try {
    const sections = parseSectionsText(String(fd.get("sections") || ""));
    const figures = parseFiguresText(String(fd.get("figures") || ""));

    await apiFetch("/api/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        manufacturer_id: state.manufacturer.id,
        title,
        pdf_url: String(fd.get("pdf_url") || "").trim(),
        revision_date: String(fd.get("revision_date") || "").trim(),
        tags: String(fd.get("tags") || "").trim(),
        sections,
        figures,
      }),
    });

    uploadMessage.textContent = "Saved.";
    uploadForm.reset();
    await loadDocuments();
  } catch (err) {
    uploadMessage.textContent = err.message;
  }
});

toolSearch.addEventListener("click", async () => {
  toolResults.innerHTML = "";
  const q = toolQuery.value.trim();
  if (!q) return;

  try {
    const res = await apiFetch(`/api/tool/search?q=${encodeURIComponent(q)}`);
    (res.results || []).forEach((r) => {
      const card = document.createElement("div");
      card.className = "document-card";
      card.innerHTML = `
        <strong>${escapeHtml(r.title)}</strong>
        <span>${escapeHtml(r.description || "")}</span>
      `;
      if (r.link) {
        const a = document.createElement("a");
        a.className = "ghost";
        a.href = r.link;
        a.target = "_blank";
        a.rel = "noreferrer";
        a.textContent = "Open";
        card.appendChild(a);
      }
      toolResults.appendChild(card);
    });
  } catch (err) {
    const card = document.createElement("div");
    card.className = "document-card";
    card.innerHTML = `<strong>Error</strong><span>${escapeHtml(err.message)}</span>`;
    toolResults.appendChild(card);
  }
});

createUserForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  createUserMessage.textContent = "";

  const fd = new FormData(createUserForm);
  const username = String(fd.get("username") || "").trim();
  const password = String(fd.get("password") || "").trim();
  const role = String(fd.get("role") || "user");

  try {
    await apiFetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, role }),
    });
    createUserMessage.textContent = "User created.";
    createUserForm.reset();
    await loadUsers();
  } catch (err) {
    createUserMessage.textContent = err.message;
  }
});

async function loadUsers() {
  if (state.user?.role !== "admin") return;
  usersList.innerHTML = "";
  const users = await apiFetch("/api/admin/users");
  users.forEach((u) => {
    const row = document.createElement("div");
    row.className = "card";
    row.innerHTML = `<strong>${escapeHtml(u.username)}</strong><span>role: ${escapeHtml(u.role)}</span>`;
    usersList.appendChild(row);
  });
}

async function loadActivity() {
  if (state.user?.role !== "admin") return;
  activityList.innerHTML = "";
  const rows = await apiFetch("/api/admin/activity?limit=200");
  rows.forEach((r) => {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <strong>${escapeHtml(r.action_type)}</strong>
      <span>${escapeHtml(r.created_at)}</span>
      <span>${escapeHtml(r.username || "unknown")} (${escapeHtml(r.role || "-")})</span>
    `;
    activityList.appendChild(card);
  });
}

tabs.forEach((tab) => {
  tab.addEventListener("click", async () => {
    const name = tab.dataset.tab;
    if (name === "admin") await loadUsers();
    if (name === "activity") await loadActivity();
  });
});

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

showView("login");
