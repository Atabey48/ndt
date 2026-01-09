const state = {
  token: null,
  user: null,
  manufacturer: null,
  manufacturers: [],
  documents: [],
};

const views = {
  login: document.getElementById("login-view"),
  manufacturer: document.getElementById("manufacturer-view"),
  dashboard: document.getElementById("dashboard-view"),
};

const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");

const manufacturerList = document.getElementById("manufacturer-list");

const dashboardTitle = document.getElementById("dashboard-title");
const roleBadge = document.getElementById("role-badge");

const docMenu = document.getElementById("doc-menu");
const contentPanel = document.getElementById("content-panel");

const adminTools = document.getElementById("admin-tools");
const uploadForm = document.getElementById("upload-form");
const uploadMessage = document.getElementById("upload-message");

const toolQuery = document.getElementById("tool-query");
const toolSearch = document.getElementById("tool-search");
const toolResults = document.getElementById("tool-results");

const backToLogin = document.getElementById("back-to-login");
const backToManufacturers = document.getElementById("back-to-manufacturers");
const logoutBtn = document.getElementById("logout");

// ---------- NAV (Back/Forward) ----------
const showView = (name, push = true) => {
  Object.values(views).forEach((v) => v.classList.remove("active"));
  views[name].classList.add("active");

  if (push) history.pushState({ view: name }, "", `#${name}`);
};

window.addEventListener("popstate", (e) => {
  const v = e.state?.view;
  if (v && views[v]) showView(v, false);
});

const apiFetch = async (path, options = {}) => {
  const headers = options.headers || {};
  if (state.token) headers.Authorization = `Bearer ${state.token}`;

  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || data?.message || "Request failed");
  return data;
};

const setTheme = (manufacturer) => {
  const color = manufacturer.theme_primary || "#0b3d91";
  document.documentElement.style.setProperty("--primary", color);
  // derive secondary lightly
  document.documentElement.style.setProperty("--secondary", "rgba(0,0,0,0.06)");
};

const renderManufacturers = (items) => {
  manufacturerList.innerHTML = "";
  items.forEach((m) => {
    const card = document.createElement("button");
    card.className = "document-card";
    card.innerHTML = `<strong>${m.name}</strong>`;
    card.addEventListener("click", () => selectManufacturer(m));
    manufacturerList.appendChild(card);
  });
};

const selectManufacturer = async (m) => {
  state.manufacturer = m;
  setTheme(m);

  dashboardTitle.textContent = `${m.name} Documents`;
  roleBadge.textContent = `Logged in as: ${state.user.username} (${state.user.role})`;

  adminTools.style.display = state.user.role === "admin" ? "block" : "none";

  await loadDocuments();
  renderDocMenu();
  contentPanel.innerHTML = `<h3>Select a document from the menu</h3><p class="hint">Sections and figures will appear here.</p>`;

  showView("dashboard");
};

const loadManufacturers = async () => {
  const items = await apiFetch("/api/manufacturers");
  state.manufacturers = items;
  renderManufacturers(items);
};

const loadDocuments = async () => {
  const docs = await apiFetch(`/api/documents?manufacturer_id=${state.manufacturer.id}`);
  state.documents = docs;
};

const renderDocMenu = () => {
  docMenu.innerHTML = "";
  state.documents.forEach((doc) => {
    const btn = document.createElement("button");
    btn.className = "menu-item";
    btn.textContent = doc.title;
    btn.addEventListener("click", async () => {
      await openDocument(doc.id);
    });
    docMenu.appendChild(btn);
  });
};

const openDocument = async (documentId) => {
  const detail = await apiFetch(`/api/documents/${documentId}`);
  const sections = detail.sections || [];
  const figures = detail.figures || [];

  const pdfLink = detail.pdf_url ? `<a class="ghost" href="${detail.pdf_url}" target="_blank" rel="noopener">Open PDF</a>` : "";

  const secHtml = sections.length
    ? `<div class="block">
         <h4>Headings</h4>
         <div class="list">
           ${sections
             .map(
               (s) => `
              <div class="row">
                <div class="row-title">${escapeHtml(s.heading_text)}</div>
                <div class="row-meta">p.${s.page_start ?? "?"}</div>
              </div>`
             )
             .join("")}
         </div>
       </div>`
    : `<div class="block"><h4>Headings</h4><p class="hint">No headings extracted.</p></div>`;

  const figHtml = figures.length
    ? `<div class="block">
         <h4>Figures</h4>
         <div class="list">
           ${figures
             .map(
               (f) => `
              <div class="row">
                <div class="row-title">${escapeHtml(f.caption_text || "Figure")}</div>
                <div class="row-meta">p.${f.page_number ?? "?"}</div>
              </div>`
             )
             .join("")}
         </div>
       </div>`
    : `<div class="block"><h4>Figures</h4><p class="hint">No figures detected.</p></div>`;

  contentPanel.innerHTML = `
    <div class="header-row" style="margin-bottom: 10px;">
      <h3>${escapeHtml(detail.title)}</h3>
      ${pdfLink}
    </div>
    <div class="hint">Uploaded: ${new Date(detail.uploaded_at).toLocaleString()}</div>
    ${secHtml}
    ${figHtml}
  `;
};

// ---------- ADMIN: PDF.js Extract ----------
const extractHeadingsAndFiguresFromPdfUrl = async (pdfUrl) => {
  // PDF.js global
  const pdfjsLib = window["pdfjsLib"];
  if (!pdfjsLib) throw new Error("PDF.js not loaded");

  // worker src
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.js";

  const loadingTask = pdfjsLib.getDocument({ url: pdfUrl });
  const pdf = await loadingTask.promise;

  const headings = [];
  const figures = [];
  let headingOrder = 1;
  let figureOrder = 1;

  // simple heuristics: line starts with "1", "1.1", "2.3.4" etc
  const headingRe = /^(\d+(?:\.\d+)*)\s+(.{3,})$/;
  const figRe = /\b(Figure|Fig\.)\b/i;

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const strings = textContent.items.map((it) => (it.str || "").trim()).filter(Boolean);

    // join close items into pseudo-lines
    // best-effort: treat each item as a line (works reasonably for many PDFs)
    for (const line of strings) {
      const m = headingRe.exec(line);
      if (m) {
        headings.push({
          heading_text: line,
          heading_level: "H1",
          page_start: pageNum,
          page_end: pageNum,
          order_index: headingOrder++,
        });
      }
      if (figRe.test(line)) {
        const lastHeading = headings.length ? headings[headings.length - 1].order_index : null;
        figures.push({
          section_order_index: lastHeading,
          page_number: pageNum,
          caption_text: line,
          order_index: figureOrder++,
        });
      }
    }
  }

  if (headings.length === 0) {
    headings.push({
      heading_text: "Document Overview",
      heading_level: "H1",
      page_start: 1,
      page_end: pdf.numPages,
      order_index: 1,
    });
  }

  return { headings, figures };
};

// ---------- TOOL SEARCH ----------
const renderToolResults = (payload) => {
  toolResults.innerHTML = "";
  const items = payload?.results || [];
  items.forEach((r) => {
    const a = document.createElement("a");
    a.className = "menu-item";
    a.href = r.link || "#";
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = `${r.title} (${r.source})`;
    toolResults.appendChild(a);
  });
};

// ---------- EVENTS ----------
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

    await loadManufacturers();
    showView("manufacturer");
  } catch (err) {
    loginError.textContent = err.message;
  }
});

backToLogin.addEventListener("click", () => showView("login"));
backToManufacturers.addEventListener("click", () => showView("manufacturer"));

logoutBtn.addEventListener("click", async () => {
  try {
    await apiFetch("/api/auth/logout", { method: "POST" });
  } catch {}
  state.token = null;
  state.user = null;
  state.manufacturer = null;
  state.documents = [];
  showView("login");
});

uploadForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  uploadMessage.textContent = "";

  if (!state.manufacturer) {
    uploadMessage.textContent = "Select manufacturer first.";
    return;
  }

  const fd = new FormData(uploadForm);
  const title = String(fd.get("title") || "").trim();
  const pdfUrl = String(fd.get("pdf_url") || "").trim();
  const revision = String(fd.get("revision_date") || "").trim();
  const tags = String(fd.get("tags") || "").trim();

  try {
    uploadMessage.textContent = "Loading PDF and extracting headings...";
    const { headings, figures } = await extractHeadingsAndFiguresFromPdfUrl(pdfUrl);

    uploadMessage.textContent = `Extracted ${headings.length} headings, ${figures.length} figures. Saving...`;

    await apiFetch("/api/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        manufacturer_id: state.manufacturer.id,
        title,
        pdf_url: pdfUrl,
        revision_date: revision || null,
        tags: tags || null,
        sections: headings,
        figures,
      }),
    });

    uploadMessage.textContent = "Saved.";
    uploadForm.reset();

    await loadDocuments();
    renderDocMenu();
  } catch (err) {
    uploadMessage.textContent = err.message;
  }
});

toolSearch.addEventListener("click", async () => {
  toolResults.innerHTML = "";
  const q = toolQuery.value.trim();
  if (!q) return;

  try {
    const payload = await apiFetch(`/api/tool/search?q=${encodeURIComponent(q)}`);
    renderToolResults(payload);
  } catch (err) {
    toolResults.innerHTML = `<div class="hint">${escapeHtml(err.message)}</div>`;
  }
});

// ---------- HELPERS ----------
function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// start
showView("login", true);
