// Шапка, подвал и центр уведомлений — общие для всех страниц.
import { api, auth } from "./api.js";
import { escapeHtml, fmt } from "./ui.js";

const NAV_ITEMS = [
  { href: "index.html", label: "Главная", icon: "bi-house" },
  { href: "events.html", label: "Мероприятия", icon: "bi-grid" },
  { href: "my-events.html", label: "Мои мероприятия", icon: "bi-ticket-perforated", auth: true },
  { href: "organizer.html", label: "Кабинет организатора", icon: "bi-speedometer2", organizer: true },
];

const NOTIFICATION_ICONS = {
  reminder: "bi-alarm text-primary",
  event_changed: "bi-pencil-square text-warning",
  event_cancelled: "bi-x-octagon text-danger",
  waitlist_promoted: "bi-arrow-up-circle text-success",
  registration: "bi-check2-circle text-success",
  review_request: "bi-star text-warning",
};

function currentPage() {
  const page = window.location.pathname.split("/").pop();
  return page || "index.html";
}

function renderHeader() {
  const page = currentPage();
  const user = auth.user;
  const links = NAV_ITEMS.filter((i) => (!i.auth || auth.isLoggedIn) && (!i.organizer || auth.isOrganizer))
    .map(
      (i) => `
      <li class="nav-item">
        <a class="nav-link ${page === i.href ? "active" : ""}" ${page === i.href ? 'aria-current="page"' : ""} href="${i.href}">
          <i class="bi ${i.icon} me-1 d-lg-none"></i>${i.label}
        </a>
      </li>`
    )
    .join("");

  const right = user
    ? `
      <button class="btn btn-link nav-icon-btn position-relative" type="button" data-bs-toggle="offcanvas"
              data-bs-target="#notificationsPanel" aria-controls="notificationsPanel" aria-label="Уведомления">
        <i class="bi bi-bell fs-5"></i>
        <span id="notificationsBadge" class="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger d-none">0</span>
      </button>
      <div class="dropdown">
        <button class="btn btn-light user-menu-btn dropdown-toggle d-flex align-items-center gap-2" type="button" data-bs-toggle="dropdown" aria-expanded="false">
          <span class="avatar-circle">${escapeHtml(user.full_name.slice(0, 1))}</span>
          <span class="d-none d-md-inline d-lg-none d-xl-inline text-truncate user-menu-name">${escapeHtml(user.full_name)}</span>
        </button>
        <ul class="dropdown-menu dropdown-menu-end shadow">
          <li><h6 class="dropdown-header">${escapeHtml(user.email)}</h6></li>
          <li><a class="dropdown-item" href="my-events.html"><i class="bi bi-ticket-perforated me-2"></i>Мои мероприятия</a></li>
          ${auth.isOrganizer ? '<li><a class="dropdown-item" href="organizer.html"><i class="bi bi-speedometer2 me-2"></i>Кабинет организатора</a></li>' : ""}
          <li><hr class="dropdown-divider"></li>
          <li><button class="dropdown-item text-danger" type="button" id="logoutBtn"><i class="bi bi-box-arrow-right me-2"></i>Выйти</button></li>
        </ul>
      </div>`
    : `<a class="btn btn-primary" href="login.html?next=${encodeURIComponent(location.pathname.split("/").pop() + location.search)}">
         <i class="bi bi-person me-1"></i>Войти
       </a>`;

  document.getElementById("appHeader").innerHTML = `
    <nav class="navbar navbar-expand-lg bg-body sticky-top border-bottom app-navbar" aria-label="Основная навигация">
      <div class="container">
        <a class="navbar-brand d-flex align-items-center gap-2 fw-bold" href="index.html">
          <span class="brand-logo"><i class="bi bi-calendar2-heart"></i></span>CampusEvents
        </a>
        <div class="d-flex align-items-center gap-2 order-lg-last">
          ${right}
          <button class="navbar-toggler border-0" type="button" data-bs-toggle="collapse" data-bs-target="#mainNav"
                  aria-controls="mainNav" aria-expanded="false" aria-label="Меню">
            <span class="navbar-toggler-icon"></span>
          </button>
        </div>
        <div class="collapse navbar-collapse" id="mainNav">
          <ul class="navbar-nav me-auto ms-lg-4">${links}</ul>
        </div>
      </div>
    </nav>
    ${bottomNav(page)}
    ${user ? notificationsPanel() : ""}`;

  document.getElementById("logoutBtn")?.addEventListener("click", () => {
    auth.clear();
    window.location.href = "index.html";
  });
}

// Нижнее меню для телефонов (на десктопе скрыто стилями)
function bottomNav(page) {
  const items = [
    { href: "index.html", label: "Главная", icon: "bi-house" },
    { href: "events.html", label: "Каталог", icon: "bi-calendar3" },
    auth.isLoggedIn
      ? { href: "my-events.html", label: "Мои", icon: "bi-ticket-perforated" }
      : { href: "login.html", label: "Войти", icon: "bi-person-circle" },
  ];
  if (auth.isOrganizer) items.push({ href: "organizer.html", label: "Кабинет", icon: "bi-speedometer2" });
  return `
    <nav class="bottom-nav" aria-label="Нижнее меню">
      ${items
        .map(
          (i) => `<a class="bottom-nav__link ${page === i.href ? "active" : ""}" href="${i.href}" ${page === i.href ? 'aria-current="page"' : ""}>
            <i class="bi ${i.icon}"></i><span>${i.label}</span></a>`
        )
        .join("")}
    </nav>`;
}

function notificationsPanel() {
  return `
    <div class="offcanvas offcanvas-end" tabindex="-1" id="notificationsPanel" aria-labelledby="notificationsTitle">
      <div class="offcanvas-header border-bottom">
        <h2 class="offcanvas-title h5" id="notificationsTitle"><i class="bi bi-bell me-2"></i>Уведомления</h2>
        <button type="button" class="btn-close" data-bs-dismiss="offcanvas" aria-label="Закрыть"></button>
      </div>
      <div class="px-3 py-2 border-bottom d-flex justify-content-end">
        <button class="btn btn-sm btn-link text-decoration-none" id="readAllBtn" type="button">Прочитать все</button>
      </div>
      <div class="offcanvas-body p-0">
        <div class="list-group list-group-flush" id="notificationsList">
          <div class="p-4 text-center text-body-secondary"><span class="spinner-border spinner-border-sm"></span></div>
        </div>
      </div>
    </div>`;
}

export async function refreshNotifications() {
  if (!auth.isLoggedIn) return;
  const badge = document.getElementById("notificationsBadge");
  const list = document.getElementById("notificationsList");
  try {
    const data = await api.notifications();
    if (badge) {
      badge.textContent = data.unread > 9 ? "9+" : data.unread;
      badge.classList.toggle("d-none", data.unread === 0);
    }
    if (!list) return;
    if (!data.items.length) {
      list.innerHTML = `<div class="p-4 text-center text-body-secondary"><i class="bi bi-inbox fs-2 d-block mb-2"></i>Уведомлений пока нет</div>`;
      return;
    }
    list.innerHTML = data.items
      .map(
        (n) => `
        <a href="${n.event_id ? `event.html?id=${n.event_id}` : "#"}" data-id="${n.id}"
           class="list-group-item list-group-item-action notification-item ${n.is_read ? "" : "notification-item--unread"}">
          <div class="d-flex gap-3">
            <i class="bi ${NOTIFICATION_ICONS[n.type] || "bi-info-circle"} fs-5"></i>
            <div class="flex-grow-1">
              <div class="fw-semibold small">${escapeHtml(n.title)}</div>
              <div class="small text-body-secondary">${escapeHtml(n.message)}</div>
              <div class="text-body-tertiary notification-item__time">${fmt.relative(n.created_at)}</div>
            </div>
          </div>
        </a>`
      )
      .join("");
    list.querySelectorAll(".notification-item--unread").forEach((el) =>
      el.addEventListener("click", () => api.readNotification(el.dataset.id).catch(() => {}))
    );
  } catch (e) {
    if (e.status === 401) {
      renderHeader();
    }
  }
}

function renderFooter() {
  const footer = document.getElementById("appFooter");
  if (!footer) return;
  footer.innerHTML = `
    <footer class="app-footer border-top py-4 mt-5">
      <div class="container d-flex flex-column flex-md-row justify-content-between align-items-center gap-2 small text-body-secondary">
        <span><i class="bi bi-calendar2-heart me-1"></i>CampusEvents — все мероприятия университета в одном месте</span>
        <span class="d-flex gap-3">
          <a class="link-secondary" href="events.html">Каталог</a>
          <a class="link-secondary" href="/docs" target="_blank" rel="noopener">API (Swagger)</a>
        </span>
      </div>
    </footer>`;
}

export function requireAuth({ organizer = false } = {}) {
  if (!auth.isLoggedIn) {
    const next = encodeURIComponent(location.pathname.split("/").pop() + location.search);
    window.location.replace(`login.html?next=${next}`);
    return false;
  }
  if (organizer && !auth.isOrganizer) {
    window.location.replace("index.html");
    return false;
  }
  return true;
}

export function initLayout() {
  renderHeader();
  renderFooter();
  if (auth.isLoggedIn) {
    refreshNotifications();
    document.getElementById("notificationsPanel")?.addEventListener("show.bs.offcanvas", refreshNotifications);
    document.getElementById("readAllBtn")?.addEventListener("click", async () => {
      await api.readAllNotifications();
      refreshNotifications();
    });
  }
}
