const state = {
  role: "user",
  username: "guest",
  adminKey: "",
  manufacturer: null,
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
const dashboardTitle = document.getElementById("dashboard-title");
const uploadForm = document.getElementById("upload-form");
const uploadMessage = document.getElementById("upload-message");
const docSearch = document.getElementById("doc-search");
const roleButtons = document.querySelectorAll(".pill");
const adminTools = document.getElementById("admin-tools");
const adminKeyWrap = document.getElementById("admin-key-wrap");

const API_BASE_URL = ""; // same domain

roleButtons.forEach((button) => {
  button.addEventListener("click", () => {
    roleButtons.forEach((btn) => btn.classList.remove("active"));
    button.classList.add("active");
    state.role = button.dataset.role || "user";

    adminKeyWrap.style.display = state.role === "admin" ? "block" : "none";
  });
});

const showView = (name) => {
  Object.values(views).forEach((v) => v.classList.remove("active"));
  views[name].classList.add("active");
};

const apiFetch = async (path, options = {}) => {
  const headers = options.headers || {};
  if (state.role === "admin" && state.adminKey) {
    headers["X-Admin-Key"] = state.adminKey;
  }

  const res = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || data?.message || "Request failed");
  }
  return data;
};

const loadManufacturers = async () => {
  const manufacturers = await apiFetch("/api/manufacturers");
  manufacturerList.innerHTML = "";
  manufacturers.forEach((m) => {
    const card = document.createElement("button");
    card.className = "document-card";
    card.innerHTML = `<strong>${m.name}</strong><span>Open</span>`;
    card.addEventListener("click", () => selectManufacturer(m));
    manufacturerList.appendChild(card);
  });
};

const selectManufacturer = async (m) => {
  state.manufacturer = m;
  dashboardTitle.textContent = `${m.name} Documents`;
  adminTools.style.display = state.role === "admin" ? "block" : "none";
  await loadDocuments();
  showView("dashboard");
};

const loadDocuments = async () => {
  const q = docSearch.value.trim();
  const url = new URL("/api/documents", location.origin);
  url.searchParams.set("manufacturer_id", String(state.manufacturer.id));
  if (q) url.searchParams.set("q", q);

  const documents = await apiFetch(`${url.pathname}?${url.searchParams.toString()}`);
  renderDocuments(documents);
};

const renderDocuments = (documents) => {
  documentList.innerHTML = "";
  documents.forEach((doc) => {
    const card = document.createElement("div");
    card.className = "document-card";

    const uploaded = doc.uploaded_at ? new Date(doc.uploaded_at).toLocaleString() : "";
    card.innerHTML = `
      <strong>${doc.title}</strong>
      <span>Uploaded: ${uploaded}</span>
      <span>Revision: ${doc.revision_date || "-"}</span>
      <span>Tags: ${doc.tags || "-"}</span>
    `;

    const link = document.createElement("a");
    link.className = "ghost";
    link.href = doc.pdf_url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Open PDF";
    card.appendChild(link);

    if (state.role === "admin") {
      const del = document.createElement("button");
      del.className = "ghost";
      del.textContent = "Delete";
      del.addEventListener("click", async () => {
        try {
          await apiFetch(`/api/documents/${doc.id}`, { method: "DELETE" });
          await loadDocuments();
        } catch (e) {
          alert(e.message);
        }
      });
      card.appendChild(del);
    }

    documentList.appendChild(card);
  });
};

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.textContent = "";

  const fd = new FormData(loginForm);
  state.username = (fd.get("username") || "guest").toString().trim() || "guest";
  state.adminKey = (fd.get("admin_key") || "").toString().trim();

  try {
    // admin seçtiyse ama key yoksa uyar
    if (state.role === "admin" && !state.adminKey) {
      throw new Error("Admin Key is required for admin mode.");
    }
    await loadManufacturers();
    showView("manufacturer");
  } catch (err) {
    loginError.textContent = err.message;
  }
});

docSearch.addEventListener("input", async () => {
  if (!state.manufacturer) return;
  await loadDocuments();
});

document.getElementById("logout").addEventListener("click", () => {
  state.manufacturer = null;
  showView("login");
});

uploadForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  uploadMessage.textContent = "";

  const fd = new FormData(uploadForm);
  try {
    await apiFetch("/api/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        manufacturer_id: state.manufacturer.id,
        title: fd.get("title"),
        pdf_url: fd.get("pdf_url"),
        revision_date: fd.get("revision_date"),
        tags: fd.get("tags"),
      }),
    });
    uploadMessage.textContent = "Saved.";
    uploadForm.reset();
    await loadDocuments();
  } catch (err) {
    uploadMessage.textContent = err.message;
  }
});

showView("login");
