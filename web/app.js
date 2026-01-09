const state = {
  token: null,
  user: null,
  manufacturer: null,
  theme: null,
  role: "user",
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
const toolQuery = document.getElementById("tool-query");
const toolSearch = document.getElementById("tool-search");
const toolResults = document.getElementById("tool-results");
const docSearch = document.getElementById("doc-search");
const roleButtons = document.querySelectorAll(".pill");

const API_BASE_URL = window.API_BASE_URL || "";

roleButtons.forEach((button) => {
  button.addEventListener("click", () => {
    roleButtons.forEach((btn) => btn.classList.remove("active"));
    button.classList.add("active");
    state.role = button.dataset.role || "user";
  });
});

const apiFetch = async (path, options = {}) => {
  const headers = options.headers || {};
  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }
  const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
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
  } else {
    document.getElementById("admin-tools").style.display = "block";
  }
  showView("dashboard");
};

const loadDocuments = async () => {
  const documents = await apiFetch(`/api/documents?manufacturer_id=${state.manufacturer.id}`);
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
        <span>${doc.revision_date ? doc.revision_date : "Revizyon yok"}</span>
        <span>${doc.tags ? doc.tags : "Etiket yok"}</span>
        <button class="ghost" data-id="${doc.id}">Detay</button>
      `;
      if (doc.pdf_url) {
        const link = document.createElement("a");
        link.className = "ghost";
        link.href = doc.pdf_url;
        link.target = "_blank";
        link.textContent = "Open PDF";
        card.appendChild(link);
      }
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
  const detail = await apiFetch(`/api/documents/${document.id}`);
  const sections = detail.sections || [];
  sectionPanel.innerHTML = `<h3>${document.title} - Detay</h3>`;
  const list = document.createElement("div");
  list.className = "list";
  if (sections.length === 0) {
    const item = document.createElement("div");
    item.className = "card";
    item.innerHTML = `
      <strong>Section bulunamadı</strong>
      <span>Bu doküman için section verisi girilmedi.</span>
    `;
    list.appendChild(item);
  } else {
    for (const section of sections) {
      const item = document.createElement("div");
      item.className = "card";
      item.innerHTML = `
        <strong>${section.heading_text}</strong>
        <span>Sayfa: ${section.page_start || "?"} - ${section.page_end || "?"}</span>
      `;
      list.appendChild(item);
    }
  }
  sectionPanel.appendChild(list);
};

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginError.textContent = "";
  const formData = new FormData(loginForm);
  try {
    state.user = {
      username: formData.get("username") || "guest",
      role: state.role,
    };
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
    await apiFetch(`/api/documents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        manufacturer_id: state.manufacturer.id,
        title: formData.get("title"),
        pdf_url: formData.get("pdf_url"),
        revision_date: formData.get("revision_date"),
        tags: formData.get("tags"),
      }),
    });
    uploadMessage.textContent = "Doküman kaydedildi.";
    uploadForm.reset();
    await loadDocuments();
  } catch (error) {
    uploadMessage.textContent = error.message;
  }
});

document.getElementById("logout").addEventListener("click", async () => {
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
  });
});

setTab("documents");

toolSearch.addEventListener("click", async () => {
  toolResults.innerHTML = "";
  const query = toolQuery.value.trim();
  if (!query) return;
  const response = await apiFetch(`/api/documents?q=${encodeURIComponent(query)}`);
  response.forEach((doc) => {
    const card = document.createElement("div");
    card.className = "document-card";
    card.innerHTML = `
      <strong>${doc.title}</strong>
      <span>${doc.tags || "Etiket yok"}</span>
      <span>${doc.revision_date || ""}</span>
    `;
    if (doc.pdf_url) {
      const link = document.createElement("a");
      link.className = "ghost";
      link.href = doc.pdf_url;
      link.target = "_blank";
      link.textContent = "Open PDF";
      card.appendChild(link);
    }
    toolResults.appendChild(card);
  });
});

docSearch.addEventListener("input", async () => {
  await loadDocuments();
});

showView("login");
