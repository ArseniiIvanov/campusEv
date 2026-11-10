import { api, auth } from "../api.js";
import { initLayout } from "../layout.js";
import { escapeHtml, qs, setLoading } from "../ui.js";

const DEMO_PASSWORD = "campus123"; // см. backend/app/seed.py

function nextUrl() {
  const next = qs("next");
  // разрешаем только относительные адреса внутри сайта
  return next && /^[\w-]+\.html(\?[\w=&%-]*)?$/.test(next) ? next : "my-events.html";
}

if (auth.isLoggedIn) {
  window.location.replace(nextUrl());
}

initLayout();

const errorBox = document.getElementById("authError");

function showError(message) {
  errorBox.innerHTML = `<i class="bi bi-exclamation-triangle me-2"></i>${escapeHtml(message)}`;
  errorBox.classList.remove("d-none");
}

async function handle(form, action) {
  errorBox.classList.add("d-none");
  form.classList.add("was-validated");
  if (!form.checkValidity()) return;
  const btn = form.querySelector("button[type=submit]");
  setLoading(btn, true);
  try {
    auth.save(await action());
    window.location.href = nextUrl();
  } catch (e) {
    showError(e.message);
    setLoading(btn, false);
  }
}

document.getElementById("loginForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  handle(f, () => api.login(f.email.value.trim(), f.password.value));
});

document.getElementById("registerForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  handle(f, () =>
    api.register({
      full_name: f.full_name.value.trim(),
      email: f.email.value.trim(),
      password: f.password.value,
      faculty_id: f.faculty_id.value ? Number(f.faculty_id.value) : null,
      student_group: f.student_group.value.trim() || null,
    })
  );
});

document.querySelectorAll("[data-demo]").forEach((btn) =>
  btn.addEventListener("click", () => {
    const f = document.getElementById("loginForm");
    f.email.value = btn.dataset.demo;
    f.password.value = DEMO_PASSWORD;
    f.requestSubmit();
  })
);

api.faculties().then((list) => {
  document.getElementById("regFaculty").insertAdjacentHTML(
    "beforeend",
    list.map((f) => `<option value="${f.id}">${escapeHtml(f.short_name)}</option>`).join("")
  );
}).catch(() => {});
