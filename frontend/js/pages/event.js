import { api, auth } from "../api.js";
import { initLayout, refreshNotifications } from "../layout.js";
import {
  emptyState,
  escapeHtml,
  fillPercent,
  fmt,
  qs,
  ratingStars,
  seatsInfo,
  setLoading,
  statusBadge,
  toast,
} from "../ui.js";

initLayout();

const page = document.getElementById("eventPage");
const eventId = Number(qs("id"));
let event = null;

function loginUrl() {
  return `login.html?next=${encodeURIComponent(`event.html?id=${eventId}`)}`;
}

function registrationBlock(compact = false) {
  const reg = event.my_registration;
  const isPast = new Date(event.end_at) < new Date();

  if (event.status === "cancelled") {
    return `<div class="alert alert-danger mb-0"><i class="bi bi-x-octagon me-2"></i>Мероприятие отменено организатором</div>`;
  }
  if (reg) {
    const qrButton = ["registered", "attended"].includes(reg.status)
      ? `<button class="btn btn-primary w-100" type="button" data-action="show-qr"><i class="bi bi-qr-code me-2"></i>Показать QR-код</button>`
      : "";
    const cancel = !isPast && reg.status !== "attended"
      ? `<button class="btn btn-link text-danger w-100 btn-sm" type="button" data-action="cancel">Отменить регистрацию</button>`
      : "";
    if (compact) {
      return `<div class="d-flex w-100 gap-2 align-items-center">${statusBadge(reg.status, reg.waitlist_position)}
        <a class="btn btn-primary ms-auto" href="my-events.html"><i class="bi bi-ticket-perforated me-1"></i>Мои мероприятия</a></div>`;
    }
    const waitNote = reg.status === "waitlist"
      ? `<p class="small text-body-secondary mt-2 mb-2">Вы №${reg.waitlist_position} в очереди. Когда место освободится, мы пришлём уведомление, а QR-код появится автоматически.</p>`
      : "";
    return `
      <div class="mb-2">${statusBadge(reg.status, reg.waitlist_position)}</div>
      ${waitNote}
      <div class="d-grid gap-2 mt-3">${qrButton}
        <a class="btn btn-outline-primary w-100" href="my-events.html"><i class="bi bi-ticket-perforated me-2"></i>Мои мероприятия</a>
        ${cancel}
      </div>`;
  }
  if (isPast) {
    return `<div class="alert alert-secondary mb-0 small"><i class="bi bi-flag me-2"></i>Мероприятие завершилось</div>`;
  }
  if (!event.registration_open) {
    return `<div class="alert alert-secondary mb-0 small"><i class="bi bi-lock me-2"></i>Регистрация закрыта</div>`;
  }
  const full = event.seats_left === 0;
  const label = full ? "Встать в лист ожидания" : "Зарегистрироваться";
  const icon = full ? "bi-hourglass-split" : "bi-check2-circle";
  if (!auth.isLoggedIn) {
    return `<a class="btn btn-primary btn-lg w-100" href="${loginUrl()}"><i class="bi ${icon} me-2"></i>${label}</a>
      ${compact ? "" : '<p class="small text-body-secondary text-center mt-2 mb-0">Нужно войти в аккаунт</p>'}`;
  }
  return `<button class="btn btn-primary btn-lg w-100" type="button" data-action="register"><i class="bi ${icon} me-2"></i>${label}</button>`;
}

function render() {
  document.title = `${event.title} — CampusEvents`;
  const tags = event.tags.map((t) => `<a class="tag-chip" href="events.html?tag=${encodeURIComponent(t.name)}">#${escapeHtml(t.name)}</a>`).join("");
  const program = event.program.length
    ? `<ol class="timeline">${event.program
        .map(
          (p) => `
          <li class="timeline__item">
            <span class="timeline__time">${fmt.time(p.start_at)}</span>
            <div class="fw-semibold">${escapeHtml(p.title)}</div>
            ${p.speaker ? `<div class="small text-body-secondary"><i class="bi bi-person me-1"></i>${escapeHtml(p.speaker)}</div>` : ""}
            ${new Date(p.start_at).toDateString() !== new Date(event.start_at).toDateString() ? `<div class="small text-body-tertiary">${fmt.date(p.start_at)}</div>` : ""}
          </li>`
        )
        .join("")}</ol>`
    : `<p class="text-body-secondary mb-0">Программа будет опубликована позже.</p>`;

  page.innerHTML = `
    <section class="event-hero wave-tile wave-tile--alt pt-4 pb-5 mb-4">
      <div class="container">
        <nav aria-label="Навигационная цепочка">
          <ol class="breadcrumb small mb-3">
            <li class="breadcrumb-item"><a class="link-light" href="index.html">Главная</a></li>
            <li class="breadcrumb-item"><a class="link-light" href="events.html">Мероприятия</a></li>
            <li class="breadcrumb-item"><a class="link-light" href="events.html?category=${event.category.slug}">${escapeHtml(event.category.name)}</a></li>
          </ol>
        </nav>
        <div class="d-flex justify-content-between gap-4">
          <div>
            <div class="d-flex flex-wrap gap-2 mb-3">
              <span class="badge rounded-pill bg-white text-dark"><i class="bi ${event.category.icon} me-1"></i>${escapeHtml(event.category.name)}</span>
              ${event.faculty ? `<span class="badge rounded-pill bg-white bg-opacity-25">${escapeHtml(event.faculty.short_name)}</span>` : ""}
              ${event.rating ? `<span class="badge rounded-pill bg-white bg-opacity-25"><i class="bi bi-star-fill text-warning me-1"></i>${event.rating} · ${fmt.plural(event.reviews_count, "отзыв", "отзыва", "отзывов")}</span>` : ""}
            </div>
            <h1 class="display-6 fw-bold mb-2">${escapeHtml(event.title)}</h1>
            <p class="lead opacity-75 mb-4">${escapeHtml(event.short_description)}</p>
            <div class="d-flex flex-wrap gap-4">
              <div><i class="bi bi-calendar3 me-2"></i>${fmt.range(event.start_at, event.end_at)}</div>
              <div><i class="bi bi-geo-alt me-2"></i>${escapeHtml(event.venue.name)}</div>
            </div>
          </div>
          <i class="bi ${event.category.icon} event-hero__icon d-none d-md-block" aria-hidden="true"></i>
        </div>
      </div>
    </section>

    <div class="container">
      <div class="row g-4">
        <div class="col-lg-8 order-2 order-lg-1">
          <section class="card info-card shadow-sm mb-4" aria-labelledby="aboutTitle">
            <div class="card-body p-4">
              <h2 class="h5 fw-bold mb-3" id="aboutTitle">О мероприятии</h2>
              <p class="mb-3" style="white-space:pre-line">${escapeHtml(event.description)}</p>
              <div>${tags}</div>
            </div>
          </section>

          <section class="card info-card shadow-sm mb-4" aria-labelledby="programTitle">
            <div class="card-body p-4">
              <h2 class="h5 fw-bold mb-3" id="programTitle">Программа</h2>
              ${program}
            </div>
          </section>

          <section class="card info-card shadow-sm mb-4" aria-labelledby="placeTitle">
            <div class="card-body p-4">
              <h2 class="h5 fw-bold mb-3" id="placeTitle">Место и организатор</h2>
              <div class="row g-3">
                <div class="col-sm-6 d-flex gap-3">
                  <span class="info-tile-icon"><i class="bi bi-building"></i></span>
                  <div>
                    <div class="fw-semibold">${escapeHtml(event.venue.name)}</div>
                    <div class="small text-body-secondary">${escapeHtml(event.venue.building)}${event.venue.room ? `, ${escapeHtml(event.venue.room)}` : ""}</div>
                    <div class="small text-body-secondary">${escapeHtml(event.venue.address)}</div>
                  </div>
                </div>
                <div class="col-sm-6 d-flex gap-3">
                  <span class="info-tile-icon"><i class="bi bi-person-badge"></i></span>
                  <div>
                    <div class="fw-semibold">${escapeHtml(event.organizer.full_name)}</div>
                    <div class="small text-body-secondary">Организатор${event.faculty ? ` · ${escapeHtml(event.faculty.name)}` : ""}</div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section class="card info-card shadow-sm" aria-labelledby="reviewsTitle" id="reviewsSection">
            <div class="card-body p-4">
              <h2 class="h5 fw-bold mb-3" id="reviewsTitle">Отзывы</h2>
              <div id="reviewForm"></div>
              <div id="reviewsList"><div class="text-center py-3"><span class="spinner-border spinner-border-sm"></span></div></div>
            </div>
          </section>
        </div>

        <aside class="col-lg-4 order-1 order-lg-2">
          <div class="card info-card shadow-sm register-card">
            <div class="card-body p-4">
              <div class="d-flex justify-content-between align-items-baseline mb-1">
                <span class="fw-semibold">Участники</span>
                <span class="small text-body-secondary">${event.registered_count} / ${event.capacity}</span>
              </div>
              <div class="progress seats-progress mb-2" role="progressbar" aria-label="Заполненность" aria-valuenow="${fillPercent(event)}" aria-valuemin="0" aria-valuemax="100">
                <div class="progress-bar" style="width:${fillPercent(event)}%"></div>
              </div>
              <div class="small mb-3">${seatsInfo(event)}${event.waitlist_count ? ` <span class="text-body-secondary">· в очереди ${event.waitlist_count}</span>` : ""}</div>
              <ul class="list-unstyled small text-body-secondary mb-4">
                <li class="mb-1"><i class="bi bi-calendar-event me-2"></i>${fmt.weekday(event.start_at)}, ${fmt.date(event.start_at)}</li>
                <li class="mb-1"><i class="bi bi-clock me-2"></i>${fmt.timeRange(event.start_at, event.end_at)}</li>
                ${event.registration_deadline ? `<li><i class="bi bi-hourglass me-2"></i>Регистрация до ${fmt.full(event.registration_deadline)}</li>` : ""}
              </ul>
              <div id="registrationBlock">${registrationBlock()}</div>
              ${auth.isLoggedIn ? `<button class="btn btn-light w-100 mt-2" type="button" data-action="favorite" aria-pressed="${event.is_favorite}">
                <i class="bi ${event.is_favorite ? "bi-heart-fill text-danger" : "bi-heart"} me-2"></i>${event.is_favorite ? "В избранном" : "В избранное"}</button>` : ""}
            </div>
          </div>
        </aside>
      </div>
    </div>

    <div class="mobile-register-bar align-items-center gap-2">${registrationBlock(true)}</div>`;

  document.body.classList.toggle("has-mobile-bar", true);
  loadReviews();
}

// ---------- Отзывы ----------

async function loadReviews() {
  const list = document.getElementById("reviewsList");
  const formHost = document.getElementById("reviewForm");
  formHost.innerHTML = event.can_review
    ? `
      <form class="rounded-3 p-3 mb-4 bg-body-secondary" id="addReviewForm" novalidate>
        <div class="fw-semibold mb-1">Как вам мероприятие?</div>
        <div class="star-input mb-2" role="radiogroup" aria-label="Оценка">
          ${[5, 4, 3, 2, 1].map((n) => `<input type="radio" name="rating" id="star${n}" value="${n}" required><label for="star${n}" title="${n}"><i class="bi bi-star-fill"></i></label>`).join("")}
        </div>
        <label class="visually-hidden" for="reviewComment">Комментарий</label>
        <textarea class="form-control mb-2" id="reviewComment" name="comment" rows="3" maxlength="2000" placeholder="Что понравилось, что можно улучшить?"></textarea>
        <div class="invalid-feedback d-block d-none" id="ratingError">Поставьте оценку от 1 до 5</div>
        <button class="btn btn-primary" type="submit"><i class="bi bi-send me-1"></i>Отправить отзыв</button>
      </form>`
    : "";

  document.getElementById("addReviewForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const rating = f.querySelector('input[name="rating"]:checked')?.value;
    document.getElementById("ratingError").classList.toggle("d-none", Boolean(rating));
    if (!rating) return;
    const btn = f.querySelector("button[type=submit]");
    setLoading(btn, true, "Отправка…");
    try {
      await api.addReview(event.id, { rating: Number(rating), comment: f.comment.value });
      toast("Спасибо за отзыв!");
      event.can_review = false;
      loadReviews();
    } catch (err) {
      toast(err.message, "danger");
      setLoading(btn, false);
    }
  });

  try {
    const data = await api.reviews(event.id);
    if (!data.count) {
      list.innerHTML = `<p class="text-body-secondary mb-0">Отзывов пока нет. Их могут оставить посетители после мероприятия.</p>`;
      return;
    }
    const bars = [5, 4, 3, 2, 1]
      .map((n) => {
        const pct = Math.round((data.distribution[n] / data.count) * 100);
        return `<div class="d-flex align-items-center gap-2 small"><span class="text-body-secondary" style="width:1rem">${n}</span>
          <div class="progress rating-bar flex-grow-1" role="progressbar" aria-label="${n} звёзд" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><div class="progress-bar" style="width:${pct}%"></div></div>
          <span class="text-body-secondary" style="width:2rem">${data.distribution[n]}</span></div>`;
      })
      .join("");
    list.innerHTML = `
      <div class="row g-3 align-items-center mb-3">
        <div class="col-sm-4 text-center">
          <div class="display-5 fw-bold">${data.average}</div>
          ${ratingStars(data.average, { size: "fs-lg" })}
          <div class="small text-body-secondary">${fmt.plural(data.count, "оценка", "оценки", "оценок")}</div>
        </div>
        <div class="col-sm-8">${bars}</div>
      </div>
      ${data.items
        .map(
          (r) => `
          <div class="review-item py-3">
            <div class="d-flex justify-content-between align-items-center mb-1">
              <span class="fw-semibold"><span class="avatar-circle me-2" style="width:1.75rem;height:1.75rem;font-size:.8rem">${escapeHtml(r.author[0])}</span>${escapeHtml(r.author)}</span>
              <span class="small text-body-tertiary">${fmt.date(r.created_at)}</span>
            </div>
            ${ratingStars(r.rating)}
            ${r.comment ? `<p class="mb-0 mt-1">${escapeHtml(r.comment)}</p>` : ""}
          </div>`
        )
        .join("")}`;
  } catch (e) {
    list.innerHTML = `<div class="alert alert-danger">${escapeHtml(e.message)}</div>`;
  }
}

// ---------- Действия ----------

async function showQr(registration, { title, subtitle, waitlist = false } = {}) {
  const body = document.getElementById("registrationModalBody");
  const isWait = waitlist || registration.status === "waitlist";
  body.innerHTML = `
    <div class="success-check ${isWait ? "success-check--waitlist" : ""} mb-3"><i class="bi ${isWait ? "bi-hourglass-split" : "bi-check-lg"}"></i></div>
    <h2 class="h4 fw-bold" id="registrationModalTitle">${escapeHtml(title || event.title)}</h2>
    <p class="text-body-secondary">${escapeHtml(subtitle || "Покажите этот QR-код организатору на входе")}</p>
    ${isWait ? "" : `
      <div class="d-flex justify-content-center mb-2">
        <div class="ticket__qr d-grid place-items-center" id="qrHolder"><span class="spinner-border m-auto"></span></div>
      </div>
      <div class="small text-body-secondary mb-1">${fmt.range(event.start_at, event.end_at)} · ${escapeHtml(event.venue.name)}</div>
      <div class="ticket__token text-body-tertiary mb-3">Код: ${escapeHtml(registration.qr_token)}</div>`}
    <div class="d-grid gap-2">
      <a class="btn btn-primary" href="my-events.html"><i class="bi bi-ticket-perforated me-2"></i>Перейти в «Мои мероприятия»</a>
      <button class="btn btn-light" type="button" data-bs-dismiss="modal">Закрыть</button>
    </div>`;
  bootstrap.Modal.getOrCreateInstance("#registrationModal").show();
  if (!isWait) {
    try {
      const url = await api.qrImageUrl(registration.id);
      document.getElementById("qrHolder").innerHTML = `<img src="${url}" class="img-fluid" alt="QR-код для входа на мероприятие">`;
    } catch (e) {
      document.getElementById("qrHolder").innerHTML = `<span class="small text-danger">${escapeHtml(e.message)}</span>`;
    }
  }
}

async function reload() {
  event = await api.event(eventId);
  render();
}

page.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;

  if (action === "register") {
    setLoading(btn, true, "Регистрируем…");
    try {
      const result = await api.registerForEvent(event.id);
      await reload();
      refreshNotifications();
      const wait = result.registration.status === "waitlist";
      showQr(result.registration, {
        title: wait ? "Вы в листе ожидания" : "Вы зарегистрированы!",
        subtitle: result.message,
        waitlist: wait,
      });
    } catch (err) {
      toast(err.message, "danger");
      if (err.status === 401) window.location.href = loginUrl();
      setLoading(btn, false);
    }
  }

  if (action === "show-qr") {
    showQr(event.my_registration, { title: "Ваш QR-код" });
  }

  if (action === "cancel") {
    bootstrap.Modal.getOrCreateInstance("#cancelModal").show();
  }

  if (action === "favorite") {
    try {
      if (event.is_favorite) await api.removeFavorite(event.id);
      else await api.addFavorite(event.id);
      event.is_favorite = !event.is_favorite;
      toast(event.is_favorite ? "Добавлено в избранное" : "Удалено из избранного", "info");
      render();
    } catch (err) {
      toast(err.message, "danger");
    }
  }
});

document.getElementById("confirmCancelBtn").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  setLoading(btn, true, "Отменяем…");
  try {
    await api.cancelRegistration(event.id);
    bootstrap.Modal.getInstance("#cancelModal").hide();
    toast("Регистрация отменена", "info");
    await reload();
  } catch (err) {
    toast(err.message, "danger");
  } finally {
    setLoading(btn, false);
  }
});

(async () => {
  if (!eventId) {
    page.innerHTML = `<div class="container">${emptyState("bi-question-circle", "Мероприятие не указано", "Вернитесь в каталог и выберите мероприятие.", '<a class="btn btn-primary" href="events.html">В каталог</a>')}</div>`;
    return;
  }
  try {
    await reload();
  } catch (e) {
    page.innerHTML = `<div class="container">${emptyState("bi-calendar-x", "Мероприятие не найдено", escapeHtml(e.message), '<a class="btn btn-primary" href="events.html">В каталог</a>')}</div>`;
  }
})();
