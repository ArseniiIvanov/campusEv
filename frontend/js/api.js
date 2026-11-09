// Клиент REST API CampusEvents. Все запросы видны во вкладке Network (Fetch/XHR).

const API_BASE = "/api";
const TOKEN_KEY = "ce_token";
const USER_KEY = "ce_user";

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const auth = {
  get token() {
    return localStorage.getItem(TOKEN_KEY);
  },
  get user() {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY));
    } catch {
      return null;
    }
  },
  get isLoggedIn() {
    return Boolean(this.token);
  },
  get isOrganizer() {
    return ["organizer", "admin"].includes(this.user?.role);
  },
  save({ access_token, user }) {
    localStorage.setItem(TOKEN_KEY, access_token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },
};

function errorMessage(body, status) {
  if (!body) return `Ошибка ${status}`;
  if (typeof body.detail === "string") return body.detail;
  if (Array.isArray(body.detail)) {
    return body.detail
      .map((d) => (d.msg || "").replace(/^Value error, /, ""))
      .filter(Boolean)
      .join("; ");
  }
  return `Ошибка ${status}`;
}

export async function request(path, { method = "GET", body, query, raw = false } = {}) {
  const url = new URL(API_BASE + path, window.location.origin);
  if (query) {
    Object.entries(query).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "" && v !== false) url.searchParams.set(k, v);
    });
  }
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth.token) headers.Authorization = `Bearer ${auth.token}`;

  const response = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (response.status === 401 && auth.token) {
    auth.clear();
  }
  if (!response.ok) {
    let data = null;
    try {
      data = await response.json();
    } catch {
      /* тело ответа не JSON */
    }
    throw new ApiError(response.status, errorMessage(data, response.status), data);
  }
  if (raw) return response;
  if (response.status === 204) return null;
  return response.json();
}

export const api = {
  // Авторизация
  login: (email, password) => request("/auth/login", { method: "POST", body: { email, password } }),
  register: (data) => request("/auth/register", { method: "POST", body: data }),
  me: () => request("/auth/me"),

  // Справочники
  categories: () => request("/categories"),
  tags: () => request("/tags"),
  venues: () => request("/venues"),
  faculties: () => request("/faculties"),
  stats: () => request("/stats"),

  // Мероприятия
  events: (query) => request("/events", { query }),
  event: (id) => request(`/events/${id}`),
  registerForEvent: (id) => request(`/events/${id}/register`, { method: "POST" }),
  cancelRegistration: (id) => request(`/events/${id}/register`, { method: "DELETE" }),
  addFavorite: (id) => request(`/events/${id}/favorite`, { method: "PUT" }),
  removeFavorite: (id) => request(`/events/${id}/favorite`, { method: "DELETE" }),
  reviews: (id) => request(`/events/${id}/reviews`),
  addReview: (id, data) => request(`/events/${id}/reviews`, { method: "POST", body: data }),
  createEvent: (data) => request("/events", { method: "POST", body: data }),
  updateEvent: (id, data) => request(`/events/${id}`, { method: "PUT", body: data }),
  cancelEvent: (id) => request(`/events/${id}/cancel`, { method: "POST" }),

  // Личный кабинет
  myRegistrations: (scope) => request("/me/registrations", { query: { scope } }),
  myFavorites: () => request("/me/favorites"),
  notifications: () => request("/me/notifications"),
  readNotification: (id) => request(`/me/notifications/${id}/read`, { method: "POST" }),
  readAllNotifications: () => request("/me/notifications/read-all", { method: "POST" }),
  async qrImageUrl(registrationId) {
    const response = await request(`/me/registrations/${registrationId}/qr`, { raw: true });
    return URL.createObjectURL(await response.blob());
  },

  // Организатор
  dashboard: () => request("/organizer/dashboard"),
  participants: (eventId) => request(`/organizer/events/${eventId}/participants`),
  updateParticipant: (registrationId, status) =>
    request(`/organizer/registrations/${registrationId}`, { method: "PATCH", body: { status } }),
  checkIn: (qr_token, event_id) => request("/organizer/check-in", { method: "POST", body: { qr_token, event_id } }),
};
