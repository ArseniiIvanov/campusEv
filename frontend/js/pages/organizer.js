import { api } from "../api.js";
import { initLayout, requireAuth } from "../layout.js";
import { emptyState, escapeHtml, fmt, ratingStars, setLoading, statusBadge, toast } from "../ui.js";

let dashboard = null;
let participants = [];
let participantsEvent = null;
let participantsFilter = "all";
let editingEventId = null;
const lookups = { categories: [], venues: [], faculties: [] };

if (requireAuth({ organizer: true })) {
  initLayout();
  init();
}

// ---------- Статистика и таблица ----------

function renderStats() {
  const d = dashboard;
  const cards = [
    { icon: "bi-calendar-event", bg: "rgba(59,111,216,.18)", color: "#8db0ff", value: d.events_total, label: "мероприятий" },
    { icon: "bi-calendar-check", bg: "rgba(34,184,207,.16)", color: "#5fd4e6", value: d.upcoming_total, label: "предстоящих" },
    { icon: "bi-people", bg: "rgba(239,79,90,.16)", color: "#ff8a92", value: d.registrations_total, label: "регистраций" },
    { icon: "bi-patch-check", bg: "rgba(34,163,90,.18)", color: "#5fd38d", value: d.attended_total, label: "пришли по QR" },
    { icon: "bi-star", bg: "rgba(245,179,53,.16)", color: "#f5b335", value: d.average_rating ?? "—", label: "средний рейтинг" },
  ];
  document.getElementById("statsRow").innerHTML = cards
    .map(
      (c) => `
      <div class="col-6 col-md-4 col-xl">
        <div class="card stat-card shadow-sm h-100"><div class="card-body d-flex align-items-center gap-3">
          <span class="stat-card__icon" style="background:${c.bg};color:${c.color}"><i class="bi ${c.icon}"></i></span>
          <div><div class="stat-card__value">${c.value}</div><div class="small text-body-secondary">${c.label}</div></div>
        </div></div>
      </div>`
    )
    .join("");
}

function renderTable() {
  const scope = document.querySelector('input[name="eventsScope"]:checked').value;
  const now = new Date();
  const rows = dashboard.events.filter((r) =>
    scope === "upcoming" ? new Date(r.event.end_at) >= now : new Date(r.event.end_at) < now
  );
  if (scope === "upcoming") rows.sort((a, b) => new Date(a.event.start_at) - new Date(b.event.start_at));

  const tbody = document.getElementById("eventsTable");
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="7">${emptyState("bi-calendar-x", "Нет мероприятий", "Создайте первое мероприятие.")}</td></tr>`;
    return;
  }
  tbody.innerHTML = rows
    .map(({ event: e, attended_count, fill_rate }) => {
      const cancelled = e.status === "cancelled";
      const isPast = new Date(e.end_at) < now;
      return `
      <tr class="${cancelled ? "opacity-50" : ""}">
        <td class="ps-4">
          <a class="fw-semibold text-body text-decoration-none" href="event.html?id=${e.id}">${escapeHtml(e.title)}</a>
          <div class="small text-body-secondary"><i class="bi ${e.category.icon} me-1"></i>${escapeHtml(e.category.name)}
            ${cancelled ? '<span class="badge text-bg-danger ms-1">Отменено</span>' : ""}
            ${e.status === "draft" ? '<span class="badge text-bg-secondary ms-1">Черновик</span>' : ""}
            <span class="d-md-none">· ${fmt.dateShort(e.start_at)}</span></div>
        </td>
        <td class="d-none d-md-table-cell small text-nowrap">${fmt.date(e.start_at)}<div class="text-body-secondary">${fmt.time(e.start_at)}</div></td>
        <td style="min-width:8rem">
          <div class="small mb-1">${e.registered_count} / ${e.capacity} <span class="text-body-secondary">(${Math.round(fill_rate)}%)</span></div>
          <div class="progress seats-progress" role="progressbar" aria-label="Заполненность" aria-valuenow="${Math.round(fill_rate)}" aria-valuemin="0" aria-valuemax="100"><div class="progress-bar" style="width:${Math.min(fill_rate, 100)}%"></div></div>
        </td>
        <td class="d-none d-lg-table-cell text-center">${e.waitlist_count || "—"}</td>
        <td class="d-none d-lg-table-cell text-center">${attended_count || "—"}</td>
        <td class="d-none d-lg-table-cell text-center small">${e.rating ? `${ratingStars(e.rating)}<div>${e.rating}</div>` : "—"}</td>
        <td class="text-end pe-4 text-nowrap">
          <button class="btn btn-sm btn-light" type="button" data-participants="${e.id}" title="Участники"><i class="bi bi-people"></i><span class="d-none d-xl-inline ms-1">Участники</span></button>
          <div class="dropdown d-inline-block">
            <button class="btn btn-sm btn-light" type="button" data-bs-toggle="dropdown" aria-expanded="false" aria-label="Ещё"><i class="bi bi-three-dots-vertical"></i></button>
            <ul class="dropdown-menu dropdown-menu-end shadow">
              <li><a class="dropdown-item" href="event.html?id=${e.id}"><i class="bi bi-eye me-2"></i>Открыть</a></li>
              ${!cancelled && !isPast ? `<li><button class="dropdown-item" type="button" data-edit="${e.id}"><i class="bi bi-pencil me-2"></i>Изменить</button></li>
              <li><button class="dropdown-item" type="button" data-checkin="${e.id}"><i class="bi bi-qr-code-scan me-2"></i>Сканер входа</button></li>
              <li><hr class="dropdown-divider"></li>
              <li><button class="dropdown-item text-danger" type="button" data-cancel-event="${e.id}"><i class="bi bi-x-octagon me-2"></i>Отменить мероприятие</button></li>` : ""}
            </ul>
          </div>
        </td>
      </tr>`;
    })
    .join("");
}

async function loadDashboard() {
  dashboard = await api.dashboard();
  renderStats();
  renderTable();
  const select = document.getElementById("checkinEvent");
  const current = select.value;
  select.innerHTML =
    '<option value="">Любое из моих</option>' +
    dashboard.events
      .filter((r) => r.event.status === "published")
      .sort((a, b) => new Date(a.event.start_at) - new Date(b.event.start_at))
      .map((r) => `<option value="${r.event.id}">${fmt.dateShort(r.event.start_at)} — ${escapeHtml(r.event.title)}</option>`)
      .join("");
  select.value = current;
}

// ---------- Участники ----------

function renderParticipants() {
  const q = document.getElementById("participantsSearch").value.trim().toLowerCase();
  const counts = participants.reduce((acc, p) => ({ ...acc, [p.status]: (acc[p.status] || 0) + 1 }), {});
  const filters = [
    ["all", "Все", participants.length],
    ["registered", "Участники", counts.registered || 0],
    ["waitlist", "Очередь", counts.waitlist || 0],
    ["attended", "Пришли", counts.attended || 0],
    ["cancelled", "Отменили", counts.cancelled || 0],
  ];
  document.getElementById("participantsFilters").innerHTML = filters
    .map(
      ([key, label, n]) => `<button type="button" class="btn btn-sm ${participantsFilter === key ? "btn-primary" : "btn-light"}" data-pfilter="${key}">
        ${label} <span class="badge text-bg-light ms-1">${n}</span></button>`
    )
    .join("");

  const rows = participants.filter(
    (p) =>
      (participantsFilter === "all" || p.status === participantsFilter) &&
      (!q || [p.full_name, p.email, p.student_group].some((v) => (v || "").toLowerCase().includes(q)))
  );
  document.getElementById("participantsTable").innerHTML = rows.length
    ? rows
        .map(
          (p) => `
          <tr>
            <td><div class="fw-semibold">${escapeHtml(p.full_name)}</div><div class="small text-body-secondary">${escapeHtml(p.email)}</div></td>
            <td class="d-none d-md-table-cell small">${escapeHtml(p.student_group || "—")}${p.faculty ? `<div class="text-body-secondary">${escapeHtml(p.faculty)}</div>` : ""}</td>
            <td>${statusBadge(p.status, p.waitlist_position)}${p.checked_in_at ? `<div class="small text-body-secondary mt-1">вход ${fmt.time(p.checked_in_at)}</div>` : ""}</td>
            <td class="d-none d-md-table-cell small text-body-secondary">${fmt.date(p.registered_at)}</td>
            <td class="text-end text-nowrap">
              ${p.status === "registered" || p.status === "waitlist" ? `<button class="btn btn-sm btn-outline-danger" type="button" data-pstatus="cancelled" data-reg="${p.registration_id}">Отменить</button>` : ""}
              ${p.status === "cancelled" ? `<button class="btn btn-sm btn-outline-primary" type="button" data-pstatus="registered" data-reg="${p.registration_id}">Восстановить</button>` : ""}
            </td>
          </tr>`
        )
        .join("")
    : `<tr><td colspan="5" class="text-center text-body-secondary py-4">Никого не найдено</td></tr>`;
}

async function openParticipants(eventId) {
  participantsEvent = dashboard.events.find((r) => r.event.id === eventId).event;
  participantsFilter = "all";
  document.getElementById("participantsSearch").value = "";
  document.getElementById("participantsTitle").textContent = participantsEvent.title;
  document.getElementById("participantsSubtitle").textContent =
    `${fmt.full(participantsEvent.start_at)} · ${participantsEvent.venue.name}`;
  document.getElementById("participantsTable").innerHTML =
    '<tr><td colspan="5" class="text-center py-4"><span class="spinner-border spinner-border-sm"></span></td></tr>';
  bootstrap.Modal.getOrCreateInstance("#participantsModal").show();
  participants = await api.participants(eventId);
  renderParticipants();
}

// ---------- Форма мероприятия ----------

function toLocalInput(iso) {
  return iso ? iso.slice(0, 16) : "";
}

function programRow(item = {}) {
  const id = crypto.randomUUID().slice(0, 8);
  return `
    <div class="row g-2 align-items-center program-row">
      <div class="col-5 col-md-3">
        <label class="visually-hidden" for="pt-${id}">Время</label>
        <input class="form-control form-control-sm" type="datetime-local" id="pt-${id}" data-field="start_at" value="${toLocalInput(item.start_at)}" required>
      </div>
      <div class="col-7 col-md-5">
        <label class="visually-hidden" for="pn-${id}">Пункт программы</label>
        <input class="form-control form-control-sm" id="pn-${id}" data-field="title" placeholder="Пункт программы" value="${escapeHtml(item.title || "")}" required>
      </div>
      <div class="col-10 col-md-3">
        <label class="visually-hidden" for="ps-${id}">Спикер</label>
        <input class="form-control form-control-sm" id="ps-${id}" data-field="speaker" placeholder="Спикер" value="${escapeHtml(item.speaker || "")}">
      </div>
      <div class="col-2 col-md-1 text-end">
        <button class="btn btn-sm btn-light text-danger" type="button" data-remove-program aria-label="Удалить пункт"><i class="bi bi-trash"></i></button>
      </div>
    </div>`;
}

async function ensureLookups() {
  if (lookups.categories.length) return;
  [lookups.categories, lookups.venues, lookups.faculties] = await Promise.all([api.categories(), api.venues(), api.faculties()]);
  const form = document.getElementById("eventForm");
  form.category_id.innerHTML = lookups.categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");
  form.venue_id.innerHTML = lookups.venues
    .map((v) => `<option value="${v.id}">${escapeHtml(v.name)} (${escapeHtml(v.building)}) — до ${v.capacity} чел.</option>`)
    .join("");
  form.faculty_id.insertAdjacentHTML("beforeend", lookups.faculties.map((f) => `<option value="${f.id}">${escapeHtml(f.name)}</option>`).join(""));
}

async function openEventForm(eventId = null) {
  await ensureLookups();
  editingEventId = eventId;
  const form = document.getElementById("eventForm");
  form.reset();
  form.classList.remove("was-validated");
  document.getElementById("eventFormError").classList.add("d-none");
  document.getElementById("programItems").innerHTML = "";

  if (eventId) {
    const e = await api.event(eventId);
    document.getElementById("eventFormTitle").textContent = "Изменить мероприятие";
    form.title.value = e.title;
    form.short_description.value = e.short_description;
    form.description.value = e.description;
    form.category_id.value = e.category.id;
    form.venue_id.value = e.venue.id;
    form.faculty_id.value = e.faculty?.id || "";
    form.capacity.value = e.capacity;
    form.start_at.value = toLocalInput(e.start_at);
    form.end_at.value = toLocalInput(e.end_at);
    form.registration_deadline.value = toLocalInput(e.registration_deadline);
    form.tags.value = e.tags.map((t) => t.name).join(", ");
    form.publish.checked = e.status !== "draft";
    document.getElementById("programItems").innerHTML = e.program.map(programRow).join("");
  } else {
    document.getElementById("eventFormTitle").textContent = "Новое мероприятие";
    const start = new Date();
    start.setDate(start.getDate() + 7);
    start.setHours(18, 0, 0, 0);
    const end = new Date(start);
    end.setHours(20);
    const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    form.start_at.value = iso(start);
    form.end_at.value = iso(end);
    form.capacity.value = 50;
  }
  bootstrap.Modal.getOrCreateInstance("#eventFormModal").show();
}

function collectEventForm(form) {
  return {
    title: form.title.value.trim(),
    short_description: form.short_description.value.trim(),
    description: form.description.value.trim(),
    category_id: Number(form.category_id.value),
    venue_id: Number(form.venue_id.value),
    faculty_id: form.faculty_id.value ? Number(form.faculty_id.value) : null,
    capacity: Number(form.capacity.value),
    start_at: form.start_at.value,
    end_at: form.end_at.value,
    registration_deadline: form.registration_deadline.value || null,
    tags: form.tags.value.split(",").map((t) => t.trim()).filter(Boolean),
    program: [...document.querySelectorAll(".program-row")].map((row) => ({
      start_at: row.querySelector('[data-field="start_at"]').value,
      title: row.querySelector('[data-field="title"]').value.trim(),
      speaker: row.querySelector('[data-field="speaker"]').value.trim() || null,
    })),
    publish: form.publish.checked,
  };
}

// ---------- Сканер входа ----------

let stream = null;
let scanning = false;

async function startCamera() {
  const video = document.getElementById("qrVideo");
  if (!("BarcodeDetector" in window)) {
    toast("Браузер не поддерживает сканирование — введите код вручную", "warning");
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
  } catch {
    toast("Нет доступа к камере", "danger");
    return;
  }
  video.srcObject = stream;
  video.classList.remove("d-none");
  await video.play();
  const detector = new BarcodeDetector({ formats: ["qr_code"] });
  scanning = true;
  const tick = async () => {
    if (!scanning) return;
    try {
      const codes = await detector.detect(video);
      if (codes.length) {
        document.getElementById("checkinToken").value = codes[0].rawValue;
        stopCamera();
        document.getElementById("checkinForm").requestSubmit();
        return;
      }
    } catch {
      /* кадр не распознан */
    }
    requestAnimationFrame(tick);
  };
  tick();
}

function stopCamera() {
  scanning = false;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  document.getElementById("qrVideo").classList.add("d-none");
}

// ---------- Инициализация ----------

async function init() {
  try {
    await loadDashboard();
  } catch (e) {
    document.getElementById("eventsTable").innerHTML = `<tr><td colspan="7"><div class="alert alert-danger m-3">${escapeHtml(e.message)}</div></td></tr>`;
    return;
  }

  document.querySelectorAll('input[name="eventsScope"]').forEach((r) => r.addEventListener("change", renderTable));
  document.getElementById("createEventBtn").addEventListener("click", () => openEventForm());

  document.getElementById("eventsTable").addEventListener("click", async (e) => {
    const t = e.target.closest("button");
    if (!t) return;
    if (t.dataset.participants) openParticipants(Number(t.dataset.participants));
    if (t.dataset.edit) openEventForm(Number(t.dataset.edit));
    if (t.dataset.checkin) {
      document.getElementById("checkinEvent").value = t.dataset.checkin;
      bootstrap.Offcanvas.getOrCreateInstance("#checkinPanel").show();
    }
    if (t.dataset.cancelEvent) {
      cancelEventId = Number(t.dataset.cancelEvent);
      bootstrap.Modal.getOrCreateInstance("#cancelEventModal").show();
    }
  });

  let cancelEventId = null;
  document.getElementById("confirmCancelEventBtn").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    setLoading(btn, true, "Отменяем…");
    try {
      await api.cancelEvent(cancelEventId);
      bootstrap.Modal.getInstance("#cancelEventModal").hide();
      toast("Мероприятие отменено, участники уведомлены", "info");
      loadDashboard();
    } catch (err) {
      toast(err.message, "danger");
    } finally {
      setLoading(btn, false);
    }
  });

  document.getElementById("participantsSearch").addEventListener("input", renderParticipants);
  document.getElementById("participantsModal").addEventListener("click", async (e) => {
    const f = e.target.closest("[data-pfilter]");
    if (f) {
      participantsFilter = f.dataset.pfilter;
      renderParticipants();
      return;
    }
    const b = e.target.closest("[data-pstatus]");
    if (!b) return;
    setLoading(b, true, "");
    try {
      await api.updateParticipant(Number(b.dataset.reg), b.dataset.pstatus);
      participants = await api.participants(participantsEvent.id);
      renderParticipants();
      toast("Статус участника обновлён");
      loadDashboard();
    } catch (err) {
      toast(err.message, "danger");
      setLoading(b, false);
    }
  });

  document.getElementById("addProgramItem").addEventListener("click", () => {
    const start = document.getElementById("fStart").value;
    document.getElementById("programItems").insertAdjacentHTML("beforeend", programRow({ start_at: start }));
  });
  document.getElementById("programItems").addEventListener("click", (e) => {
    e.target.closest("[data-remove-program]")?.closest(".program-row").remove();
  });

  document.getElementById("eventForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const errorBox = document.getElementById("eventFormError");
    form.classList.add("was-validated");
    if (!form.checkValidity()) return;
    const btn = document.getElementById("eventFormSubmit");
    setLoading(btn, true, "Сохранение…");
    try {
      const data = collectEventForm(form);
      const saved = editingEventId ? await api.updateEvent(editingEventId, data) : await api.createEvent(data);
      bootstrap.Modal.getInstance("#eventFormModal").hide();
      toast(editingEventId ? "Изменения сохранены, участники уведомлены" : "Мероприятие создано");
      await loadDashboard();
      if (!editingEventId) window.open(`event.html?id=${saved.id}`, "_self");
    } catch (err) {
      errorBox.innerHTML = `<i class="bi bi-exclamation-triangle me-2"></i>${escapeHtml(err.message)}`;
      errorBox.classList.remove("d-none");
    } finally {
      setLoading(btn, false);
    }
  });

  document.getElementById("startCameraBtn").addEventListener("click", startCamera);
  document.getElementById("checkinPanel").addEventListener("hidden.bs.offcanvas", stopCamera);
  document.getElementById("checkinForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const result = document.getElementById("checkinResult");
    form.classList.add("was-validated");
    if (!form.checkValidity()) return;
    try {
      const r = await api.checkIn(form.qr_token.value.trim(), form.event_id.value ? Number(form.event_id.value) : null);
      result.innerHTML = `
        <div class="alert ${r.ok ? "alert-success" : "alert-warning"} checkin-result">
          <div class="fw-bold"><i class="bi ${r.ok ? "bi-check-circle-fill" : "bi-exclamation-circle-fill"} me-2"></i>${escapeHtml(r.message)}</div>
          <div class="mt-1">${escapeHtml(r.participant)}</div>
          <div class="small">${escapeHtml(r.event_title)} · ${fmt.time(r.checked_in_at)}</div>
        </div>`;
      form.qr_token.value = "";
      form.classList.remove("was-validated");
      loadDashboard();
    } catch (err) {
      result.innerHTML = `<div class="alert alert-danger checkin-result"><i class="bi bi-x-circle-fill me-2"></i>${escapeHtml(err.message)}</div>`;
    }
  });
}
