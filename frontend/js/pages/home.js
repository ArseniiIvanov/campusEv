import { api } from "../api.js";
import { initLayout } from "../layout.js";
import { emptyState, escapeHtml, eventCard, fmt, skeletonCards } from "../ui.js";

initLayout();

async function loadStats() {
  try {
    const stats = await api.stats();
    document.querySelectorAll("[data-stat]").forEach((el) => {
      el.textContent = stats[el.dataset.stat].toLocaleString("ru-RU");
    });
  } catch {
    /* статистика не критична для страницы */
  }
}

async function loadCategories() {
  const grid = document.getElementById("categoriesGrid");
  try {
    const categories = await api.categories();
    grid.innerHTML = categories
      .map(
        (c, i) => `
        <div class="col-12 col-sm-6 col-lg-4">
          <a class="category-tile wave-tile ${["", "wave-tile--alt", "wave-tile--sparkle"][i % 3]} h-100" href="events.html?category=${c.slug}">
            <span class="category-tile__icon"><i class="bi ${c.icon}"></i></span>
            <span>
              <span class="d-block fw-semibold">${escapeHtml(c.name)}</span>
              <span class="category-tile__count">${fmt.plural(c.events_count, "событие", "события", "событий")}</span>
            </span>
          </a>
        </div>`
      )
      .join("");
  } catch (e) {
    grid.innerHTML = `<div class="col-12"><div class="alert alert-danger">${escapeHtml(e.message)}</div></div>`;
  }
}

async function loadUpcoming() {
  const grid = document.getElementById("upcomingGrid");
  grid.innerHTML = skeletonCards(6);
  try {
    const page = await api.events({ page_size: 6, sort: "date" });
    grid.innerHTML = page.items.length
      ? page.items.map((e) => `<div class="col-sm-6 col-lg-4">${eventCard(e)}</div>`).join("")
      : `<div class="col-12">${emptyState("bi-calendar-x", "Пока пусто", "Скоро здесь появятся новые мероприятия.")}</div>`;
  } catch (e) {
    grid.innerHTML = `<div class="col-12"><div class="alert alert-danger">${escapeHtml(e.message)}</div></div>`;
  }
}

loadStats();
loadCategories();
loadUpcoming();
