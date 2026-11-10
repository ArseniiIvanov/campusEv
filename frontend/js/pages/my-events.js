import { api, auth } from "../api.js";
import { initLayout, requireAuth } from "../layout.js";
import { coverStyle, emptyState, escapeHtml, eventCard, fmt, statusBadge } from "../ui.js";

if (requireAuth()) {
  initLayout();
  init();
}

let allRegistrations = [];
let calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

function registrationRow(reg, { history = false } = {}) {
  const ev = reg.event;
  const d = new Date(ev.start_at);
  const qrBtn = ["registered", "attended"].includes(reg.status) && !history
    ? `<button class="btn btn-primary btn-sm" type="button" data-qr="${reg.id}"><i class="bi bi-qr-code me-1"></i>QR-код</button>`
    : "";
  let historyInfo = "";
  if (history) {
    if (reg.status === "attended") {
      historyInfo = `<div class="small text-success"><i class="bi bi-patch-check me-1"></i>Вход подтверждён ${reg.checked_in_at ? fmt.time(reg.checked_in_at) : ""}</div>`;
    } else if (reg.status === "registered") {
      historyInfo = `<div class="small text-body-secondary"><i class="bi bi-dash-circle me-1"></i>Не посещено</div>`;
    } else if (reg.status === "waitlist") {
      historyInfo = `<div class="small text-body-secondary"><i class="bi bi-hourglass me-1"></i>Место так и не освободилось</div>`;
    }
  }
  const reviewBtn = history && reg.status === "attended"
    ? reg.has_review
      ? `<span class="small text-body-secondary"><i class="bi bi-star-fill text-warning me-1"></i>Отзыв оставлен</span>`
      : `<a class="btn btn-outline-primary btn-sm" href="event.html?id=${ev.id}#reviewsSection"><i class="bi bi-star me-1"></i>Оставить отзыв</a>`
    : "";
  const badge = history && reg.status === "registered" ? "" : statusBadge(reg.status, reg.waitlist_position);

  return `
    <article class="card my-event shadow-sm">
      <div class="card-body d-flex gap-3 align-items-center flex-wrap flex-md-nowrap">
        <div class="my-event__date wave-tile">
          <span class="my-event__day">${d.getDate()}</span>
          <span class="my-event__month">${fmt.dateShort(ev.start_at).split(" ")[1] || ""}</span>
        </div>
        <div class="my-event__info">
          <div class="d-flex flex-wrap gap-2 align-items-center mb-1">
            <span class="small text-body-secondary"><i class="bi ${ev.category.icon} me-1"></i>${escapeHtml(ev.category.name)}</span>
            ${badge}
          </div>
          <h3 class="h6 fw-bold mb-1"><a class="text-body text-decoration-none" href="event.html?id=${ev.id}">${escapeHtml(ev.title)}</a></h3>
          <div class="small text-body-secondary">
            <i class="bi bi-clock me-1"></i>${fmt.weekday(ev.start_at)}, ${fmt.timeRange(ev.start_at, ev.end_at)}
            <span class="mx-1">·</span><i class="bi bi-geo-alt me-1"></i>${escapeHtml(ev.venue.name)}
          </div>
          ${historyInfo}
          ${!history && ev.status === "cancelled" ? '<div class="small text-danger"><i class="bi bi-x-octagon me-1"></i>Мероприятие отменено</div>' : ""}
        </div>
        <div class="my-event__actions d-flex gap-2 align-items-center ms-md-auto">
          ${qrBtn}${reviewBtn}
          <a class="btn btn-light btn-sm" href="event.html?id=${ev.id}">Подробнее</a>
        </div>
      </div>
    </article>`;
}

function renderSummary(upcoming, past) {
  const attended = past.filter((r) => r.status === "attended").length;
  const next = upcoming.find((r) => r.status === "registered");
  const cards = [
    { icon: "bi-calendar-check", color: "#4f46e5", value: upcoming.filter((r) => r.status === "registered").length, label: "предстоит" },
    { icon: "bi-hourglass-split", color: "#f59e0b", value: upcoming.filter((r) => r.status === "waitlist").length, label: "в листе ожидания" },
    { icon: "bi-patch-check", color: "#16a34a", value: attended, label: "посещено" },
  ];
  document.getElementById("summaryCards").innerHTML =
    cards
      .map(
        (c) => `
        <div class="col-4 col-lg-2">
          <div class="card stat-card shadow-sm h-100"><div class="card-body p-3">
            <div class="stat-card__value" style="color:${c.color}">${c.value}</div>
            <div class="small text-body-secondary">${c.label}</div>
          </div></div>
        </div>`
      )
      .join("") +
    `<div class="col-12 col-lg-6">
      <div class="card stat-card shadow-sm h-100"><div class="card-body p-3 d-flex align-items-center gap-3">
        <span class="stat-card__icon bg-primary-subtle text-primary"><i class="bi bi-alarm"></i></span>
        ${next
          ? `<div style="min-width:0"><div class="small text-body-secondary">Следующее мероприятие ${fmt.relative(next.event.start_at)}</div>
             <a class="fw-semibold text-body text-decoration-none d-block text-truncate" href="event.html?id=${next.event.id}">${escapeHtml(next.event.title)}</a></div>`
          : `<div class="small text-body-secondary">Нет ближайших мероприятий — загляните в каталог</div>`}
      </div></div>
    </div>`;
}

function renderLists(upcoming, past) {
  document.getElementById("upcomingList").innerHTML = upcoming.length
    ? upcoming.map((r) => registrationRow(r)).join("")
    : emptyState("bi-calendar-plus", "Вы пока никуда не записаны", "Выберите интересное мероприятие в каталоге.", '<a class="btn btn-primary" href="events.html">Открыть каталог</a>');
  document.getElementById("historyList").innerHTML = past.length
    ? past.map((r) => registrationRow(r, { history: true })).join("")
    : emptyState("bi-clock-history", "История пуста", "Здесь появятся мероприятия, которые вы посетили.");
}

function renderCalendar() {
  const grid = document.getElementById("calendarGrid");
  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();
  document.getElementById("calendarTitle").textContent = calendarMonth.toLocaleDateString("ru-RU", { month: "long", year: "numeric" });

  const weekdays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7; // понедельник — первый день
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayStr = new Date().toDateString();

  const byDay = {};
  allRegistrations.forEach((r) => {
    const d = new Date(r.event.start_at);
    if (d.getFullYear() === year && d.getMonth() === month) {
      (byDay[d.getDate()] ||= []).push(r);
    }
  });

  let html = weekdays.map((w) => `<div class="calendar__weekday">${w}</div>`).join("");
  for (let i = 0; i < offset; i += 1) html += `<div class="calendar__day calendar__day--muted" aria-hidden="true"></div>`;
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(year, month, day);
    const items = (byDay[day] || [])
      .map((r) => {
        const past = new Date(r.event.end_at) < new Date();
        return `<a class="calendar__event ${past ? "calendar__event--past" : ""}" style="${coverStyle(r.event)}"
                   href="event.html?id=${r.event.id}" title="${escapeHtml(r.event.title)}">${fmt.time(r.event.start_at)} ${escapeHtml(r.event.title)}</a>`;
      })
      .join("");
    html += `<div class="calendar__day ${date.toDateString() === todayStr ? "calendar__day--today" : ""}">
      <span class="calendar__num">${day}</span>${items}</div>`;
  }
  grid.innerHTML = html;

  const monthItems = Object.keys(byDay).sort((a, b) => a - b).flatMap((d) => byDay[d]);
  document.getElementById("calendarMobileList").innerHTML = monthItems.length
    ? monthItems
        .map(
          (r) => `<a class="d-flex gap-2 align-items-center text-decoration-none text-body small" href="event.html?id=${r.event.id}">
            <span class="badge" style="background:${r.event.category.color}">${fmt.dateShort(r.event.start_at)}</span>
            <span class="text-truncate">${escapeHtml(r.event.title)}</span></a>`
        )
        .join("")
    : `<p class="small text-body-secondary mb-0 text-center">В этом месяце мероприятий нет</p>`;
}

async function loadFavorites() {
  const grid = document.getElementById("favoritesGrid");
  try {
    const items = await api.myFavorites();
    grid.innerHTML = items.length
      ? items.map((e) => `<div class="col-sm-6 col-lg-4">${eventCard(e)}</div>`).join("")
      : `<div class="col-12">${emptyState("bi-heart", "Избранного пока нет", "Нажмите «В избранное» на странице мероприятия.")}</div>`;
  } catch (e) {
    grid.innerHTML = `<div class="col-12"><div class="alert alert-danger">${escapeHtml(e.message)}</div></div>`;
  }
}

async function showQr(regId) {
  const reg = allRegistrations.find((r) => r.id === regId);
  const body = document.getElementById("qrModalBody");
  body.innerHTML = `
    <div class="fw-semibold mb-1">${escapeHtml(reg.event.title)}</div>
    <div class="small text-body-secondary mb-3">${fmt.range(reg.event.start_at, reg.event.end_at)} · ${escapeHtml(reg.event.venue.name)}</div>
    <div class="d-flex justify-content-center mb-2"><div class="ticket__qr d-flex" id="qrImg"><span class="spinner-border m-auto"></span></div></div>
    <div class="ticket__token text-body-tertiary">Код: ${escapeHtml(reg.qr_token)}</div>
    <p class="small text-body-secondary mt-3 mb-0">Покажите QR-код организатору на входе. Можно сделать скриншот.</p>`;
  bootstrap.Modal.getOrCreateInstance("#qrModal").show();
  try {
    const url = await api.qrImageUrl(regId);
    document.getElementById("qrImg").innerHTML = `<img src="${url}" class="img-fluid" alt="QR-код для входа">`;
  } catch (e) {
    document.getElementById("qrImg").innerHTML = `<span class="small text-danger m-auto">${escapeHtml(e.message)}</span>`;
  }
}

async function init() {
  document.getElementById("greeting").textContent = `${auth.user.full_name}${auth.user.student_group ? ` · ${auth.user.student_group}` : ""}`;
  const loader = '<div class="text-center py-4"><span class="spinner-border"></span></div>';
  document.getElementById("upcomingList").innerHTML = loader;

  try {
    allRegistrations = await api.myRegistrations("all");
  } catch (e) {
    document.getElementById("upcomingList").innerHTML = `<div class="alert alert-danger">${escapeHtml(e.message)}</div>`;
    return;
  }
  const now = new Date();
  const upcoming = allRegistrations.filter((r) => new Date(r.event.end_at) >= now);
  const past = allRegistrations.filter((r) => new Date(r.event.end_at) < now).reverse();

  renderSummary(upcoming, past);
  renderLists(upcoming, past);
  renderCalendar();

  if (location.hash === "#history") bootstrap.Tab.getOrCreateInstance("#historyTab").show();

  document.getElementById("favoritesTab").addEventListener("shown.bs.tab", loadFavorites, { once: true });
  document.getElementById("prevMonth").addEventListener("click", () => {
    calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1);
    renderCalendar();
  });
  document.getElementById("nextMonth").addEventListener("click", () => {
    calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1);
    renderCalendar();
  });
  document.querySelector("main").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-qr]");
    if (btn) showQr(Number(btn.dataset.qr));
  });
}
