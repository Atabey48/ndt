const state = {
  token: null,
  user: null,
  aircraft: [],
  selectedAircraft: null,
  selectedDocument: null,
  pingTimer: null,
};

const views = {
  login: document.getElementById("view-login"),
  app: document.getElementById("view-app"),
};

const tabs = Array.from(document.querySelectorAll(".tab"));
const tabContents = Array.from(document.querySelectorAll(".tab-content"));

const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");

const whoami = document.getElementById("whoami");
const btnLogout = document.getElementById("btn-logout");

const aircraftFilter = document.getElementById("aircraft-filter");
const aircraftList = document.getElementById("aircraft-list");

const btnBackAircraft = document.getElementById("btn-back-aircraft");
const docList = document.getElementById("doc-list");
const docDetail = document.getElementById("doc-detail");

const toolQ = document.getElementById("tool-q");
const toolRun = document.getElementById("tool-run");
const toolResults = document.getElementById("tool-results");

const uploadForm = document.getElementById("upload-form");
const uploadAircraft = document.getElementById("upload-aircraft");
const uploadTitle = document.getElementById("upload-title");
const uploadRev = document.getElementById("upload-rev");
const uploadTags = document.getElementById("upload-tags");
const uploadFile = document.getElementById("upload-file");
const btnExtract = document.getElementById("btn-extract");
const extractStatus = document.getElementById("extract-status");
const sectionsJson = document.getElementById("sections-json");
const figuresJson = document.getElementById("figures-json");
const uploadMsg = document.getElementById("upload-msg");

const createUserForm = document.getElementById("create-user-form");
const newUsername = document.getElementById("new-username");
const newPassword = document.getElementById("new-password");
const newRole = document.getElementById("new-role");
const newActive = document.getElementById("new-active");
const createUserMsg = document.getElementById("create-user-msg");
const usersList = document.getElementById("users-list");

const btnRefreshSessions = document.getElementById("btn-refresh-sessions");
const sessionsList = document.getElementById("sessions-list");
const btnRefreshAudit = document.getElementById("btn-refresh-audit");
const auditList = document.getElementById("audit-list");

const API_BASE_URL = ""; // same origin

function showView(name) {
  Object.values(views).forEach((v) => v.classList.remove("active"));
  views[name].classList.add("active");
}

function setTab(name) {
  tabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  tabContents.forEach((c) => c.classList.toggle("active", c.dataset.tab === name));
}

tabs.forEach((t) =>
  t.addEventListener("click", async () => {
    setTab(t.dataset.tab);

    if (t.dataset.tab === "users") await loadUsers();
    if (t.dataset.tab === "reports") {
      await loadSessions();
      await loadAudit();
    }
  })
);

function refreshAdminVisibility() {
  const isAdmin = state.user?.role === "admin";
  document.querySelectorAll(".admin-only").forEach((el) => {
    el.style.display = isAdmin ? "" : "none";
  });
}

async function apiFetch(path, options = {}) {
  const headers = options.headers || {};
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });

  let payload = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  if (!res.ok) {
    const msg = payload?.error || payload?.detail || "Request failed";
    throw new Error(msg);
  }
  return payload;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function secondsToHuman(sec) {
  const s = Math.max(0, Number(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h) return `${h}h ${m}m ${r}s`;
  if (m) return `${m}m ${r}s`;
  return `${r}s`;
}

function startPing() {
  stopPing();
  state.pingTimer = setInterval(async () => {
    try {
      await apiFetch("/api/activity/ping", { method: "POST" });
    } catch {
      // ignore
    }
  }, 30000);
}
function stopPing() {
  if (state.pingTimer) clearInterval(state.pingTimer);
  state.pingTimer = null;
}

async function logout() {
  try {
    if (state.token) await apiFetch("/api/auth/logout", { method: "POST" });
  } catch {
    // ignore
  }
  stopPing();
  state.token = null;
  state.user = null;
  state.selectedAircraft = null;
  state.selectedDocument = null;
  whoami.textContent = "";
  showView("login");
}

btnLogout.addEventListener("click", logout);

// -------- Login ----------
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
    showView("app");
    setTab("aircraft");

    startPing();

    await loadAircraft();

    if (state.user.role === "admin") {
      await populateUploadAircraft();
    }
  } catch (err) {
    loginError.textContent = err.message;
  }
});

// -------- Aircraft ----------
aircraftFilter.addEventListener("input", () => renderAircraft());

async function loadAircraft() {
  const rows = await apiFetch("/api/aircraft");
  state.aircraft = rows || [];
  renderAircraft();
  await populateUploadAircraft();
}

function groupByManufacturer(rows) {
  const map = new Map();
  rows.forEach((r) => {
    const key = r.manufacturer_name;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  });
  return map;
}

function renderAircraft() {
  aircraftList.innerHTML = "";
  const q = aircraftFilter.value.trim().toLowerCase();

  const rows = state.aircraft.filter((x) => {
    const a = String(x.aircraft_name || "").toLowerCase();
    const m = String(x.manufacturer_name || "").toLowerCase();
    return !q || a.includes(q) || m.includes(q);
  });

  const groups = groupByManufacturer(rows);

  for (const [manufacturer, items] of groups.entries()) {
    const header = document.createElement("div");
    header.className = "document-card";
    header.innerHTML = `<strong>${escapeHtml(manufacturer)}</strong><span class="hint">Select an aircraft type</span>`;
    aircraftList.appendChild(header);

    items.forEach((a) => {
      const btn = document.createElement("button");
      btn.className = "menu-item";
      btn.innerHTML = `<strong>${escapeHtml(a.aircraft_name)}</strong>
        <span class="hint">Theme: ${escapeHtml(a.theme_primary || "-")}</span>`;
      btn.addEventListener("click", () => selectAircraft(a));
      aircraftList.appendChild(btn);
    });
  }

  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "card";
    empty.innerHTML = `<strong>No aircraft found</strong><span class="hint">Ask admin to add aircraft in DB seed (server).</span>`;
    aircraftList.appendChild(empty);
  }
}

async function selectAircraft(aircraft) {
  state.selectedAircraft = aircraft;
  document.documentElement.style.setProperty("--primary", aircraft.theme_primary || "#0033a1");
  document.documentElement.style.setProperty("--secondary", aircraft.theme_secondary || "#dce7f7");

  setTab("documents");
  await loadDocuments();
}

btnBackAircraft.addEventListener("click", () => {
  state.selectedAircraft = null;
  state.selectedDocument = null;
  docList.innerHTML = "";
  docDetail.innerHTML = `<div class="hint">Select a document.</div>`;
  setTab("aircraft");
});

// -------- Documents ----------
async function loadDocuments() {
  docList.innerHTML = "";
  docDetail.innerHTML = `<div class="hint">Select a document.</div>`;

  const aircraftId = state.selectedAircraft?.id;
  if (!aircraftId) return;

  const docs = await apiFetch(`/api/aircraft/${aircraftId}/documents`);
  renderDocuments(docs || []);
}

function renderDocuments(docs) {
  docList.innerHTML = "";

  if (!docs.length) {
    const empty = document.createElement("div");
    empty.className = "card";
    empty.innerHTML = `<strong>No documents</strong><span class="hint">Admin can upload documents for this aircraft.</span>`;
    docList.appendChild(empty);
    return;
  }

  docs.forEach((d) => {
    const btn = document.createElement("button");
    btn.className = "menu-item";
    btn.innerHTML = `
      <strong>${escapeHtml(d.title)}</strong>
      <span class="hint">${escapeHtml(d.revision_date || "No revision date")} • ${escapeHtml(d.original_filename || "")}</span>
    `;
    btn.addEventListener("click", () => loadDocumentDetail(d.id));
    docList.appendChild(btn);
  });
}

async function loadDocumentDetail(docId) {
  const detail = await apiFetch(`/api/documents/${docId}`);
  state.selectedDocument = detail;

  const isAdmin = state.user?.role === "admin";
  const deleteBtn = isAdmin
    ? `<button id="btn-delete-doc" class="ghost" type="button">Delete Document</button>`
    : "";

  const sections = detail.sections || [];
  const figures = detail.figures || [];
  const pdfUrl = detail.pdf_url;

  const sectionsHtml = sections.length
    ? sections
        .map(
          (s) => `
        <button class="menu-item" data-page="${s.page_start || 1}">
          <strong>${escapeHtml(s.heading_text)}</strong>
          <span class="hint">Pages: ${escapeHtml(s.page_start ?? "?")} - ${escapeHtml(s.page_end ?? "?")}</span>
        </button>
      `
        )
        .join("")
    : `<div class="document-card"><strong>No headings</strong><span class="hint">Upload-time extraction may have found none.</span></div>`;

  const figuresHtml = figures.length
    ? figures
        .map(
          (f) => `
        <div class="document-card">
          <strong>${escapeHtml(f.caption_text || "Figure")}</strong>
          <span class="hint">Page: ${escapeHtml(f.page_number ?? "?")}</span>
        </div>
      `
        )
        .join("")
    : `<div class="document-card"><strong>No figures</strong><span class="hint">Figure extraction is heuristic.</span></div>`;

  docDetail.innerHTML = `
    <div class="document-card">
      <div class="row">
        <div>
          <strong>${escapeHtml(detail.title)}</strong>
          <div class="hint">${escapeHtml(detail.original_filename || "")}</div>
        </div>
        <div class="actions">
          <a class="ghost" href="${escapeHtml(pdfUrl)}" target="_blank" rel="noreferrer">Open PDF</a>
          ${deleteBtn}
        </div>
      </div>
      <div class="hint">Revision: ${escapeHtml(detail.revision_date || "-")} • Tags: ${escapeHtml(detail.tags || "-")}</div>
    </div>

    <div class="document-card">
      <strong>PDF Viewer</strong>
      <iframe id="pdf-frame" class="pdf-frame" src="${escapeHtml(pdfUrl)}#page=1"></iframe>
      <div class="hint">Use headings below to jump pages.</div>
    </div>

    <div class="document-card">
      <strong>Headings</strong>
      <div id="sections-list" class="list">${sectionsHtml}</div>
    </div>

    <div class="document-card">
      <strong>Figures</strong>
      <div class="list">${figuresHtml}</div>
    </div>
  `;

  const pdfFrame = document.getElementById("pdf-frame");
  const sectionsList = document.getElementById("sections-list");

  if (sectionsList) {
    sectionsList.querySelectorAll("button[data-page]").forEach((b) => {
      b.addEventListener("click", () => {
        const page = Number(b.getAttribute("data-page") || "1") || 1;
        pdfFrame.src = `${pdfUrl}#page=${page}`;
      });
    });
  }

  const btnDeleteDoc = document.getElementById("btn-delete-doc");
  if (btnDeleteDoc) {
    btnDeleteDoc.addEventListener("click", async () => {
      if (!confirm("Delete this document? This cannot be undone.")) return;
      try {
        await apiFetch(`/api/documents/${docId}`, { method: "DELETE" });
        state.selectedDocument = null;
        await loadDocuments();
        docDetail.innerHTML = `<div class="hint">Document deleted.</div>`;
      } catch (err) {
        alert(err.message);
      }
    });
  }
}

// -------- Tool Search ----------
toolRun.addEventListener("click", async () => {
  toolResults.innerHTML = "";
  const q = toolQ.value.trim();
  if (!q) return;

  try {
    const res = await apiFetch(`/api/tool/search?q=${encodeURIComponent(q)}`);
    const rows = res.results || [];

    if (!rows.length) {
      toolResults.innerHTML = `<div class="document-card"><strong>No results</strong><span class="hint">Try a different keyword.</span></div>`;
      return;
    }

    rows.forEach((r) => {
      const card = document.createElement("div");
      card.className = "document-card";
      const features = (r.features || []).slice(0, 10);
      card.innerHTML = `
        <strong>${escapeHtml(r.title || "Result")}</strong>
        <span class="hint">${escapeHtml(r.source || "")}</span>
        <span>${escapeHtml(r.description || "")}</span>
        ${features.length ? `<span class="hint">Features: ${escapeHtml(features.join(", "))}</span>` : ""}
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
    toolResults.innerHTML = `<div class="document-card"><strong>Error</strong><span>${escapeHtml(err.message)}</span></div>`;
  }
});

// -------- Admin Upload (PDF -> headings/figures) ----------
async function populateUploadAircraft() {
  if (!uploadAircraft) return;
  uploadAircraft.innerHTML = "";

  (state.aircraft || []).forEach((a) => {
    const opt = document.createElement("option");
    opt.value = String(a.id);
    opt.textContent = `${a.manufacturer_name} — ${a.aircraft_name}`;
    uploadAircraft.appendChild(opt);
  });
}

btnExtract?.addEventListener("click", async () => {
  extractStatus.textContent = "";
  const file = uploadFile.files?.[0];
  if (!file) {
    extractStatus.textContent = "Please choose a PDF first.";
    return;
  }

  try {
    extractStatus.textContent = "Extracting...";
    const arrayBuffer = await file.arrayBuffer();

    if (!window.pdfjsLib) {
      extractStatus.textContent = "PDF.js not loaded.";
      return;
    }

    // Configure worker
    // pdfjsLib.GlobalWorkerOptions.workerSrc is optional in newer builds; CDN may handle it.
    const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    // 1) Try outline-based extraction
    const outline = await pdf.getOutline().catch(() => null);

    const sections = [];
    if (Array.isArray(outline) && outline.length) {
      for (const item of outline.slice(0, 120)) {
        const title = String(item.title || "").trim();
        if (!title) continue;

        let pageStart = null;
        try {
          const dest = await pdf.getDestination(item.dest);
          if (dest && dest[0]) {
            const pageIndex = await pdf.getPageIndex(dest[0]);
            pageStart = pageIndex + 1;
          }
        } catch {
          // ignore
        }

        sections.push({
          heading_text: title,
          page_start: pageStart || 1,
          page_end: null,
        });
      }
    }

    // 2) Fallback: heuristic headings from text
    if (!sections.length) {
      const maxPages = Math.min(pdf.numPages, 25);
      const headingRegex = /^(\d+(\.\d+){0,4})\s+([A-Z][A-Za-z0-9 \-,:/]{6,})$/;

      for (let p = 1; p <= maxPages; p++) {
        const page = await pdf.getPage(p);
        const text = await page.getTextContent();
        const lines = text.items.map((it) => String(it.str || "").trim()).filter(Boolean);

        for (const line of lines) {
          const m = line.match(headingRegex);
          if (m) {
            sections.push({ heading_text: line, page_start: p, page_end: null });
          }
        }
      }
    }

    // 3) Figures heuristic
    const figures = [];
    const figRegex = /\b(Figure|Fig\.)\s*\d+[^A-Za-z0-9]*([A-Za-z0-9].{0,80})?/i;

    const maxFigPages = Math.min(pdf.numPages, 40);
    const seen = new Set();

    for (let p = 1; p <= maxFigPages; p++) {
      const page = await pdf.getPage(p);
      const text = await page.getTextContent();
      const lines = text.items.map((it) => String(it.str || "").trim()).filter(Boolean);

      for (const line of lines) {
        const m = line.match(figRegex);
        if (m) {
          const caption = line.slice(0, 120);
          const key = `${p}:${caption}`;
          if (seen.has(key)) continue;
          seen.add(key);
          figures.push({ caption_text: caption, page_number: p });
        }
      }
    }

    sectionsJson.value = JSON.stringify(sections.slice(0, 200), null, 2);
    figuresJson.value = JSON.stringify(figures.slice(0, 200), null, 2);

    extractStatus.textContent = `Done. Headings: ${sections.length}, Figures: ${figures.length}`;
  } catch (err) {
    extractStatus.textContent = `Extraction failed: ${err.message}`;
  }
});

uploadForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  uploadMsg.textContent = "";

  try {
    const aircraftId = Number(uploadAircraft.value || "0");
    if (!aircraftId) throw new Error("Aircraft is required.");

    const title = uploadTitle.value.trim();
    if (!title) throw new Error("Title is required.");

    const file = uploadFile.files?.[0];
    if (!file) throw new Error("PDF is required.");

    // Validate JSON fields (must be valid JSON arrays)
    let s = [];
    let f = [];
    try {
      s = JSON.parse(sectionsJson.value || "[]");
      if (!Array.isArray(s)) s = [];
    } catch {
      throw new Error("Sections JSON is invalid.");
    }
    try {
      f = JSON.parse(figuresJson.value || "[]");
      if (!Array.isArray(f)) f = [];
    } catch {
      throw new Error("Figures JSON is invalid.");
    }

    const fd = new FormData();
    fd.set("title", title);
    fd.set("revision_date", uploadRev.value.trim());
    fd.set("tags", uploadTags.value.trim());
    fd.set("sections_json", JSON.stringify(s));
    fd.set("figures_json", JSON.stringify(f));
    fd.set("file", file);

    await apiFetch(`/api/aircraft/${aircraftId}/documents`, {
      method: "POST",
      body: fd,
    });

    uploadMsg.textContent = "Upload complete.";
    uploadForm.reset();
    sectionsJson.value = "[]";
    figuresJson.value = "[]";
    extractStatus.textContent = "";

    // If admin uploaded to currently selected aircraft, refresh documents
    if (state.selectedAircraft?.id === aircraftId) {
      await loadDocuments();
    }
  } catch (err) {
    uploadMsg.textContent = err.message;
  }
});

// -------- Admin Users ----------
createUserForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  createUserMsg.textContent = "";

  try {
    const username = newUsername.value.trim();
    const password = newPassword.value.trim();
    const role = newRole.value;
    const is_active = !!newActive.checked;

    await apiFetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, role, is_active }),
    });

    createUserMsg.textContent = "User created.";
    createUserForm.reset();
    newActive.checked = true;
    await loadUsers();
  } catch (err) {
    createUserMsg.textContent = err.message;
  }
});

async function loadUsers() {
  if (state.user?.role !== "admin") return;

  usersList.innerHTML = "";
  const rows = await apiFetch("/api/admin/users");

  rows.forEach((u) => {
    const card = document.createElement("div");
    card.className = "document-card";

    const active = !!u.is_active;

    card.innerHTML = `
      <div class="row">
        <div>
          <strong>${escapeHtml(u.username)}</strong>
          <div class="hint">role: ${escapeHtml(u.role)} • id: ${escapeHtml(u.id)}</div>
        </div>
        <div class="actions">
          <span class="badge">${active ? "active" : "inactive"}</span>
          <button class="ghost" type="button">${active ? "Disable" : "Enable"}</button>
        </div>
      </div>
    `;

    const btn = card.querySelector("button");
    btn.addEventListener("click", async () => {
      try {
        await apiFetch(`/api/admin/users/${u.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ is_active: !active }),
        });
        await loadUsers();
      } catch (err) {
        alert(err.message);
      }
    });

    usersList.appendChild(card);
  });

  if (!rows.length) {
    usersList.innerHTML = `<div class="hint">No users.</div>`;
  }
}

// -------- Reports ----------
btnRefreshSessions?.addEventListener("click", loadSessions);
btnRefreshAudit?.addEventListener("click", loadAudit);

async function loadSessions() {
  if (state.user?.role !== "admin") return;

  sessionsList.innerHTML = "";
  const rows = await apiFetch("/api/admin/reports/sessions?limit=200");

  rows.forEach((s) => {
    const card = document.createElement("div");
    card.className = "document-card";
    card.innerHTML = `
      <strong>${escapeHtml(s.username)} (${escapeHtml(s.role)})</strong>
      <span class="hint">Created: ${escapeHtml(s.created_at)}</span>
      <span class="hint">Last seen: ${escapeHtml(s.last_seen_at)}</span>
      <span class="hint">Active time: ${escapeHtml(secondsToHuman(s.active_seconds))}</span>
    `;
    sessionsList.appendChild(card);
  });

  if (!rows.length) sessionsList.innerHTML = `<div class="hint">No sessions.</div>`;
}

async function loadAudit() {
  if (state.user?.role !== "admin") return;

  auditList.innerHTML = "";
  const rows = await apiFetch("/api/admin/reports/audit?limit=300");

  rows.forEach((a) => {
    const card = document.createElement("div");
    card.className = "document-card";

    let meta = "";
    try {
      const m = JSON.parse(a.metadata_json || "{}");
      meta = JSON.stringify(m);
    } catch {
      meta = a.metadata_json || "";
    }

    card.innerHTML = `
      <strong>${escapeHtml(a.action_type)}</strong>
      <span class="hint">${escapeHtml(a.created_at)}</span>
      <span class="hint">${escapeHtml(a.username || "unknown")} (${escapeHtml(a.role || "-")})</span>
      <span class="hint">${escapeHtml(meta).slice(0, 240)}</span>
    `;
    auditList.appendChild(card);
  });

  if (!rows.length) auditList.innerHTML = `<div class="hint">No audit logs.</div>`;
}

// initial
showView("login");
