import { api } from "../api.js";
import { initLayout } from "../layout.js";
import { emptyState, escapeHtml, eventCard, fmt, skeletonCards } from "../ui.js";

initLayout();

const form = document.getElementById("filtersForm");
const grid = document.getElementById("eventsGrid");
const pagination = document.getElementById("pagination");
const resultsCount = document.getElementById("resultsCount");
const activeFilters = document.getElementById("activeFilters");
const sortSelect = document.getElementById("sortSelect");

const FILTER_KEYS = ["q", "category", "tag", "faculty_id", "date_from", "date_to", "only_available", "include_past", "sort", "page"];
const lookups = { categories: [], faculties: [] };
let state = readStateFromUrl();
let requestId = 0;

function readStateFromUrl() {
  const params = new URLSearchParams(location.search);
  const s = {};
  FILTER_KEYS.forEach((k) => {
    if (params.has(k)) s[k] = params.get(k);
  });
  s.page = Number(s.page || 1);
  return s;
}

function writeStateToUrl() {
  const params = new URLSearchParams();
  Object.entries(state).forEach(([k, v]) => {
    if (v && !(k === "page" && v === 1) && !(k === "sort" && v === "date")) params.set(k, v);
  });
  const qs = params.toString();
  history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
}

function toIsoDate(d) {
  return d.toLocaleDateString("sv-SE"); // YYYY-MM-DD в локальной зоне
}

function applyStateToForm() {
  form.q.value = state.q || "";
  form.date_from.value = state.date_from || "";
  form.date_to.value = state.date_to || "";
  form.faculty_id.value = state.faculty_id || "";
  form.tag.value = state.tag || "";
  form.only_available.checked = state.only_available === "true";
  form.include_past.checked = state.include_past === "true";
  sortSelect.value = state.sort || "date";
  const cat = form.querySelector(`input[name="category"][value="${state.category || ""}"]`);
  if (cat) cat.checked = true;
  form.querySelector("#periodAll").checked = true;
}

function collectForm() {
  return {
    q: form.q.value.trim() || undefined,
    category: form.querySelector('input[name="category"]:checked')?.value || undefined,
    tag: form.tag.value || undefined,
    faculty_id: form.faculty_id.value || undefined,
    date_from: form.date_from.value || undefined,
    date_to: form.date_to.value || undefined,
    only_available: form.only_available.checked ? "true" : undefined,
    include_past: form.include_past.checked ? "true" : undefined,
    sort: sortSelect.value,
    page: 1,
  };
}

function renderActiveFilters() {
  const chips = [];
  const add = (key, label) =>
    chips.push(
      `<button type="button" class="badge rounded-pill text-bg-light border btn" data-remove="${key}">
         ${escapeHtml(label)} <i class="bi bi-x ms-1"></i>
       </button>`
    );
  if (state.q) add("q", `«${state.q}»`);
  if (state.category) add("category", lookups.categories.find((c) => c.slug === state.category)?.name || state.category);
  if (state.tag) add("tag", `#${state.tag}`);
  if (state.faculty_id) add("faculty_id", lookups.faculties.find((f) => String(f.id) === state.faculty_id)?.short_name || "Институт");
  if (state.date_from) add("date_from", `с ${fmt.date(state.date_from)}`);
  if (state.date_to) add("date_to", `по ${fmt.date(state.date_to)}`);
  if (state.only_available) add("only_available", "Есть места");
  if (state.include_past) add("include_past", "Включая прошедшие");
  activeFilters.innerHTML = chips.join("");
  const badge = document.getElementById("filtersCountBadge");
  badge.textContent = chips.length;
  badge.classList.toggle("d-none", chips.length === 0);
}

function renderPagination(page, pages) {
  if (pages <= 1) {
    pagination.innerHTML = "";
    return;
  }
  const item = (p, label, disabled = false, active = false) => `
    <li class="page-item ${disabled ? "disabled" : ""} ${active ? "active" : ""}">
      <button class="page-link" type="button" data-page="${p}" ${disabled ? "disabled" : ""} ${active ? 'aria-current="page"' : ""}>${label}</button>
    </li>`;
  let html = item(page - 1, '<i class="bi bi-chevron-left"></i><span class="visually-hidden">Назад</span>', page === 1);
  for (let p = 1; p <= pages; p += 1) html += item(p, p, false, p === page);
  html += item(page + 1, '<i class="bi bi-chevron-right"></i><span class="visually-hidden">Вперёд</span>', page === pages);
  pagination.innerHTML = html;
}

async function loadEvents() {
  const current = ++requestId;
  writeStateToUrl();
  renderActiveFilters();
  grid.innerHTML = skeletonCards(6);
  document.getElementById("resultsSection").setAttribute("aria-busy", "true");
  try {
    const data = await api.events({ ...state, page_size: 9 });
    if (current !== requestId) return;
    resultsCount.textContent = `Найдено ${fmt.plural(data.total, "мероприятие", "мероприятия", "мероприятий")}`;
    grid.innerHTML = data.items.length
      ? data.items.map((e) => `<div class="col-sm-6 col-xl-4">${eventCard(e)}</div>`).join("")
      : `<div class="col-12">${emptyState(
          "bi-search",
          "Ничего не найдено",
          "Попробуйте изменить фильтры или поисковый запрос.",
          '<button class="btn btn-primary" type="button" id="emptyReset">Сбросить фильтры</button>'
        )}</div>`;
    document.getElementById("emptyReset")?.addEventListener("click", resetAll);
    renderPagination(data.page, data.pages);
  } catch (e) {
    grid.innerHTML = `<div class="col-12"><div class="alert alert-danger"><i class="bi bi-exclamation-triangle me-2"></i>${escapeHtml(e.message)}</div></div>`;
  } finally {
    document.getElementById("resultsSection").setAttribute("aria-busy", "false");
  }
}

function resetAll() {
  state = { sort: sortSelect.value, page: 1 };
  applyStateToForm();
  loadEvents();
}

async function loadLookups() {
  const [categories, faculties, tags] = await Promise.all([api.categories(), api.faculties(), api.tags()]);
  lookups.categories = categories;
  lookups.faculties = faculties;
  document.getElementById("categoryFilter").innerHTML =
    `<input type="radio" class="btn-check" name="category" id="catAll" value="" checked>
     <label class="btn btn-sm btn-outline-primary" for="catAll">Все</label>` +
    categories
      .map(
        (c) => `
        <input type="radio" class="btn-check" name="category" id="cat-${c.slug}" value="${c.slug}">
        <label class="btn btn-sm btn-outline-primary" for="cat-${c.slug}"><i class="bi ${c.icon} me-1"></i>${escapeHtml(c.name)}</label>`
      )
      .join("");
  document.getElementById("facultySelect").insertAdjacentHTML(
    "beforeend",
    faculties.map((f) => `<option value="${f.id}">${escapeHtml(f.short_name)} — ${escapeHtml(f.name)}</option>`).join("")
  );
  document.getElementById("tagSelect").insertAdjacentHTML(
    "beforeend",
    tags.map((t) => `<option value="${escapeHtml(t.name)}">#${escapeHtml(t.name)}</option>`).join("")
  );
}

// ----- события формы -----

let debounce;
form.addEventListener("input", (e) => {
  if (e.target.name === "period") return;
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    state = collectForm();
    loadEvents();
  }, e.target.type === "search" ? 350 : 0);
});

form.addEventListener("change", (e) => {
  if (e.target.name !== "period") return;
  const today = new Date();
  const days = { today: 0, week: 7, month: 30 }[e.target.value];
  if (days === undefined) {
    form.date_from.value = "";
    form.date_to.value = "";
  } else {
    const to = new Date(today);
    to.setDate(to.getDate() + days);
    form.date_from.value = toIsoDate(today);
    form.date_to.value = toIsoDate(to);
  }
  state = collectForm();
  loadEvents();
});

form.addEventListener("submit", (e) => e.preventDefault());
form.addEventListener("reset", (e) => {
  e.preventDefault();
  resetAll();
});

sortSelect.addEventListener("change", () => {
  state = { ...state, sort: sortSelect.value, page: 1 };
  loadEvents();
});

pagination.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-page]");
  if (!btn || btn.disabled) return;
  state = { ...state, page: Number(btn.dataset.page) };
  loadEvents();
  window.scrollTo({ top: 0, behavior: "smooth" });
});

activeFilters.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-remove]");
  if (!btn) return;
  delete state[btn.dataset.remove];
  state.page = 1;
  applyStateToForm();
  loadEvents();
});

(async () => {
  try {
    await loadLookups();
  } catch {
    /* фильтры без справочников всё равно работают */
  }
  applyStateToForm();
  loadEvents();
})();
