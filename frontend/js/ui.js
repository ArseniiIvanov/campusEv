// Общие UI-компоненты: форматирование, карточки, тосты, состояния загрузки.

const dateFmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" });
const dateShortFmt = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short" });
const weekdayFmt = new Intl.DateTimeFormat("ru-RU", { weekday: "short" });
const timeFmt = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" });
const fullFmt = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
});

export const fmt = {
  date: (iso) => dateFmt.format(new Date(iso)),
  dateShort: (iso) => dateShortFmt.format(new Date(iso)).replace(".", ""),
  weekday: (iso) => weekdayFmt.format(new Date(iso)),
  time: (iso) => timeFmt.format(new Date(iso)),
  full: (iso) => fullFmt.format(new Date(iso)),
  timeRange(start, end) {
    const s = new Date(start);
    const e = new Date(end);
    if (s.toDateString() === e.toDateString()) return `${timeFmt.format(s)}–${timeFmt.format(e)}`;
    return `${timeFmt.format(s)} — ${dateShortFmt.format(e).replace(".", "")}, ${timeFmt.format(e)}`;
  },
  range(start, end) {
    const s = new Date(start);
    const e = new Date(end);
    if (s.toDateString() === e.toDateString()) {
      return `${dateFmt.format(s)}, ${timeFmt.format(s)}–${timeFmt.format(e)}`;
    }
    return `${dateFmt.format(s)}, ${timeFmt.format(s)} — ${dateFmt.format(e)}, ${timeFmt.format(e)}`;
  },
  relative(iso) {
    const diff = (new Date(iso) - new Date()) / 1000;
    const rtf = new Intl.RelativeTimeFormat("ru", { numeric: "auto" });
    const abs = Math.abs(diff);
    if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
    if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
    return rtf.format(Math.round(diff / 86400), "day");
  },
  plural(n, one, few, many) {
    const m10 = n % 10;
    const m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return `${n} ${one}`;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return `${n} ${few}`;
    return `${n} ${many}`;
  },
};

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export const STATUS_LABELS = {
  registered: { text: "Вы участник", cls: "text-bg-success", icon: "bi-check-circle" },
  waitlist: { text: "Лист ожидания", cls: "text-bg-warning", icon: "bi-hourglass-split" },
  attended: { text: "Посещено", cls: "text-bg-primary", icon: "bi-patch-check" },
  cancelled: { text: "Отменено", cls: "text-bg-secondary", icon: "bi-x-circle" },
};

export function statusBadge(status, waitlistPosition) {
  const s = STATUS_LABELS[status];
  const suffix = status === "waitlist" && waitlistPosition ? ` · №${waitlistPosition}` : "";
  return `<span class="badge rounded-pill ${s.cls}"><i class="bi ${s.icon} me-1"></i>${s.text}${suffix}</span>`;
}

export function ratingStars(value, { size = "" } = {}) {
  if (value == null) return "";
  const full = Math.floor(value);
  const half = value - full >= 0.5;
  let html = "";
  for (let i = 1; i <= 5; i += 1) {
    const icon = i <= full ? "bi-star-fill" : i === full + 1 && half ? "bi-star-half" : "bi-star";
    html += `<i class="bi ${icon}"></i>`;
  }
  return `<span class="rating-stars ${size}" aria-label="Рейтинг ${value} из 5">${html}</span>`;
}

export function seatsInfo(event) {
  if (event.status === "finished" || new Date(event.end_at) < new Date()) {
    return `<span class="text-body-secondary"><i class="bi bi-flag me-1"></i>Завершено</span>`;
  }
  if (event.status === "cancelled") {
    return `<span class="text-danger"><i class="bi bi-x-octagon me-1"></i>Отменено</span>`;
  }
  if (event.seats_left === 0) {
    return `<span class="text-warning-emphasis"><i class="bi bi-hourglass-split me-1"></i>Мест нет · лист ожидания</span>`;
  }
  const cls = event.seats_left <= Math.max(5, event.capacity * 0.1) ? "text-danger" : "text-success";
  return `<span class="${cls}"><i class="bi bi-people me-1"></i>Осталось ${fmt.plural(event.seats_left, "место", "места", "мест")}</span>`;
}

export function fillPercent(event) {
  return Math.min(100, Math.round((event.registered_count / event.capacity) * 100));
}

export function coverStyle(event) {
  const color = event.category?.color || "#4f46e5";
  return `--cover-color:${color}`;
}

export function eventCard(event, { extra = "" } = {}) {
  const tags = event.tags
    .slice(0, 3)
    .map((t) => `<span class="tag-chip">#${escapeHtml(t.name)}</span>`)
    .join("");
  const rating = event.rating
    ? `<span class="small text-body-secondary">${ratingStars(event.rating)} ${event.rating}</span>`
    : "";
  return `
    <article class="card event-card h-100 shadow-sm">
      <a class="event-card__cover wave-tile ${event.id % 2 ? "" : "wave-tile--alt"}" href="event.html?id=${event.id}" aria-label="${escapeHtml(event.title)}">
        <i class="bi ${event.category.icon} event-card__icon"></i>
        <div class="event-card__date">
          <span class="event-card__day">${new Date(event.start_at).getDate()}</span>
          <span class="event-card__month">${fmt.dateShort(event.start_at).split(" ")[1] || ""}</span>
        </div>
        <span class="badge event-card__category"><span class="category-dot" style="--cat-color:${event.category.color}"></span>${escapeHtml(event.category.name)}</span>
      </a>
      <div class="card-body d-flex flex-column">
        <h3 class="h6 card-title mb-1">
          <a class="stretched-link text-decoration-none text-body" href="event.html?id=${event.id}">${escapeHtml(event.title)}</a>
        </h3>
        <p class="small text-body-secondary mb-2 event-card__desc">${escapeHtml(event.short_description)}</p>
        <ul class="list-unstyled small mb-2 event-card__meta">
          <li><i class="bi bi-clock me-2"></i>${fmt.weekday(event.start_at)}, ${fmt.date(event.start_at)} · ${fmt.time(event.start_at)}</li>
          <li class="text-truncate"><i class="bi bi-geo-alt me-2"></i>${escapeHtml(event.venue.name)}</li>
        </ul>
        <div class="mb-2">${tags}</div>
        <div class="mt-auto">
          <div class="progress seats-progress mb-1" role="progressbar" aria-label="Заполненность"
               aria-valuenow="${fillPercent(event)}" aria-valuemin="0" aria-valuemax="100">
            <div class="progress-bar" style="width:${fillPercent(event)}%"></div>
          </div>
          <div class="d-flex justify-content-between align-items-center small">
            ${seatsInfo(event)} ${rating}
          </div>
          ${extra}
        </div>
      </div>
    </article>`;
}

export function skeletonCards(count = 6, col = "col-sm-6 col-lg-4") {
  return Array.from({ length: count })
    .map(
      () => `
      <div class="${col}">
        <div class="card h-100 placeholder-glow" aria-hidden="true">
          <div class="placeholder w-100 skeleton-cover"></div>
          <div class="card-body">
            <span class="placeholder col-8 mb-2"></span>
            <span class="placeholder col-12"></span>
            <span class="placeholder col-6"></span>
          </div>
        </div>
      </div>`
    )
    .join("");
}

export function emptyState(icon, title, text, action = "") {
  return `
    <div class="empty-state text-center py-5">
      <div class="empty-state__icon mb-3"><i class="bi ${icon}"></i></div>
      <h3 class="h5">${title}</h3>
      <p class="text-body-secondary">${text}</p>
      ${action}
    </div>`;
}

export function toast(message, variant = "success") {
  let container = document.getElementById("toastContainer");
  if (!container) {
    container = document.createElement("div");
    container.id = "toastContainer";
    container.className = "toast-container position-fixed bottom-0 end-0 p-3";
    document.body.append(container);
  }
  const icons = { success: "bi-check-circle-fill", danger: "bi-exclamation-triangle-fill", info: "bi-info-circle-fill", warning: "bi-hourglass-split" };
  const el = document.createElement("div");
  el.className = `toast align-items-center text-bg-${variant} border-0`;
  el.setAttribute("role", "status");
  el.innerHTML = `
    <div class="d-flex">
      <div class="toast-body"><i class="bi ${icons[variant] || icons.info} me-2"></i>${escapeHtml(message)}</div>
      <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Закрыть"></button>
    </div>`;
  container.append(el);
  const t = new bootstrap.Toast(el, { delay: 4000 });
  el.addEventListener("hidden.bs.toast", () => el.remove());
  t.show();
}

export function setLoading(button, loading, text) {
  if (loading) {
    button.dataset.originalHtml = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>${text || "Подождите…"}`;
  } else {
    button.disabled = false;
    if (button.dataset.originalHtml) button.innerHTML = button.dataset.originalHtml;
  }
}

export function qs(name) {
  return new URLSearchParams(window.location.search).get(name);
}
