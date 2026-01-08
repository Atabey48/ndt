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
const manufacturerList = document.getElementById("manufacturer-list");
const documentList = document.getElementById("document-list");
const sectionPanel = document.getElementById("section-panel");
const dashboardTitle = document.getElementById("dashboard-title");
const uploadForm = document.getElementById("upload-form");
const uploadMessage = document.getElementById("upload-message");
const auditTab = document.getElementById("audit-tab");
const auditTabContent = document.getElementById("audit-tab-content");
const auditList = document.getElementById("audit-list");
const toolQuery = document.getElementById("tool-query");
const toolSearch = document.getElementById("tool-search");
const toolResults = document.getElementById("tool-results");
const docSearch = document.getElementById("doc-search");

const apiFetch = async (path, options = {}) => {
  const headers = options.headers || {};
  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }
  const response = await fetch(path, { ...options, headers });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({ detail: "Hata" }));
    throw new Error(detail.detail || "Hata");
  }
  return response.json();
};

const showView = (name) => {
  Object.values(views).forEach((view) => view.classList.remove("active"));
  views[name].classList.add("active");
};

const setTheme = (manufacturer) => {
  document.documentElement.style.setProperty("--primary", manufacturer.theme_primary || "#0b3d91");
  document.documentElement.style.setProperty("--secondary", manufacturer.theme_secondary || "#dce7f7");
  state.theme = manufacturer;
};

const renderManufacturers = (manufacturers) => {
  manufacturerList.innerHTML = "";
  manufacturers.forEach((m) => {
    const card = document.createElement("button");
    card.className = "document-card";
    card.innerHTML = `<strong>${m.name}</strong><span>Tema seç</span>`;
    card.addEventListener("click", () => selectManufacturer(m));
    manufacturerList.appendChild(card);
  });
};

const selectManufacturer = async (manufacturer) => {
  state.manufacturer = manufacturer;
  setTheme(manufacturer);
  dashboardTitle.textContent = `${manufacturer.name} Dokümanları`;
  await loadDocuments();
  if (state.user.role !== "admin") {
    document.getElementById("admin-tools").style.display = "none";
    auditTab.style.display = "none";
  } else {
    auditTab.style.display = "inline-block";
  }
  showView("dashboard");
};

const loadDocuments = async () => {
  const documents = await apiFetch(`/api/manufacturers/${state.manufacturer.id}/documents`);
  renderDocuments(documents);
};

const renderDocuments = (documents) => {
  const query = docSearch.value.toLowerCase();
  documentList.innerHTML = "";
  documents
    .filter((doc) => doc.title.toLowerCase().includes(query))
    .forEach((doc) => {
      const card = document.createElement("div");
      card.className = "document-card";
      card.innerHTML = `
        <strong>${doc.title}</strong>
        <span>${new Date(doc.uploaded_at).toLocaleDateString()}</span>
        <span>${doc.tags ? doc.tags : "Etiket yok"}</span>
        <button class="ghost" data-id="${doc.id}">Section'lar</button>
        <a class="ghost" href="/api/documents/${doc.id}/pdf" target="_blank">Open PDF</a>
      `;
      if (state.user.role === "admin") {
        const del = document.createElement("button");
        del.className = "ghost";
        del.textContent = "Sil";
        del.addEventListener("click", async () => {
          await apiFetch(`/api/documents/${doc.id}`, { method: "DELETE" });
          await loadDocuments();
        });
        card.appendChild(del);
      }
      card.querySelector("button").addEventListener("click", () => loadSections(doc));
      documentList.appendChild(card);
    });
};

const loadSections = async (document) => {
  const sections = await apiFetch(`/api/documents/${document.id}/sections`);
  sectionPanel.innerHTML = `<h3>${document.title} - Sections</h3>`;
  const list = document.createElement("div");
  list.className = "list";
  for (const section of sections) {
    const item = document.createElement("div");
    item.className = "card";
    item.innerHTML = `
      <strong>${section.heading_text}</strong>
      <span>Sayfa: ${section.page_start || "?"} - ${section.page_end || "?"}</span>
      <div class="figures" id="figures-${section.id}"></div>
    `;
    list.appendChild(item);
    const figures = await apiFetch(`/api/sections/${section.id}/figures`);
    const figContainer = item.querySelector(`#figures-${section.id}`);
    figures.forEach((figure) => {
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = figure.caption_text || "Figure";
      figContainer.appendChild(tag);
    });
  }
  sectionPanel.appendChild(list);
};

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginError.textContent = "";
  const formData = new FormData(loginForm);
  try {
    const response = await apiFetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: formData.get("username"),
        password: formData.get("password"),
      }),
    });
    state.token = response.token;
    state.user = response.user;
    const manufacturers = await apiFetch("/api/manufacturers");
    renderManufacturers(manufacturers);
    showView("manufacturer");
  } catch (error) {
    loginError.textContent = error.message;
  }
});

uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  uploadMessage.textContent = "";
  const formData = new FormData(uploadForm);
  try {
    await apiFetch(`/api/manufacturers/${state.manufacturer.id}/documents`, {
      method: "POST",
      body: formData,
    });
    uploadMessage.textContent = "PDF yüklendi.";
    uploadForm.reset();
    await loadDocuments();
  } catch (error) {
    uploadMessage.textContent = error.message;
  }
});

document.getElementById("logout").addEventListener("click", async () => {
  await apiFetch("/api/auth/logout", { method: "POST" });
  state.token = null;
  state.user = null;
  state.manufacturer = null;
  showView("login");
});

const tabs = document.querySelectorAll(".tab");
const tabContents = document.querySelectorAll(".tab-content");

const setTab = (name) => {
  tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === name));
  tabContents.forEach((content) => content.classList.toggle("active", content.dataset.tab === name));
};

tabs.forEach((tab) => {
  tab.addEventListener("click", async () => {
    setTab(tab.dataset.tab);
    if (tab.dataset.tab === "audit" && state.user.role === "admin") {
      const logs = await apiFetch("/api/audit-logs");
      auditList.innerHTML = logs
        .map((log) => `
          <div class="document-card">
            <strong>${log.action_type}</strong>
            <span>${new Date(log.created_at).toLocaleString()}</span>
            <span>${log.metadata_json || ""}</span>
          </div>
        `)
        .join("");
    }
  });
});

setTab("documents");

toolSearch.addEventListener("click", async () => {
  toolResults.innerHTML = "";
  const query = toolQuery.value.trim();
  if (!query) return;
  const response = await apiFetch("/api/tool/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  response.results.forEach((result) => {
    const card = document.createElement("div");
    card.className = "document-card";
    card.innerHTML = `
      <strong>${result.title}</strong>
      <span>${result.description}</span>
      <div>${result.features.map((f) => `<span class="tag">${f}</span>`).join("")}</div>
      <span>${result.source}</span>
      <a class="ghost" href="${result.link}" target="_blank">Link</a>
    `;
    toolResults.appendChild(card);
  });
});

docSearch.addEventListener("input", async () => {
  await loadDocuments();
});

showView("login");
