"""Точка входа CampusEvents: REST API + раздача фронтенда."""
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .database import Base, SessionLocal, engine
from .routers import auth, events, me, meta, organizer
from .seed import seed_if_empty

FRONTEND_DIR = Path(__file__).resolve().parents[2] / "frontend"

DESCRIPTION = """
API платформы **CampusEvents** — единого каталога университетских мероприятий.

**Ключевой сценарий:** каталог → карточка → регистрация → QR-код → «Мои мероприятия».

Как авторизоваться в Swagger:
1. Выполните `POST /api/auth/login` (демо-аккаунты — в README).
2. Скопируйте `access_token` и нажмите **Authorize** вверху страницы.
"""

TAGS = [
    {"name": "Авторизация", "description": "Регистрация, вход, текущий пользователь (JWT)."},
    {"name": "Мероприятия", "description": "Каталог с фильтрами, карточка, запись, лист ожидания, отзывы, управление."},
    {"name": "Личный кабинет участника", "description": "Мои мероприятия, история посещений, QR-коды, уведомления."},
    {"name": "Кабинет организатора", "description": "Статистика, список участников, подтверждение входа по QR."},
    {"name": "Справочники", "description": "Категории, теги, площадки, институты, общая статистика."},
]


@asynccontextmanager
async def lifespan(_app: FastAPI):
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        seed_if_empty(db)
    yield


app = FastAPI(
    title="CampusEvents API",
    version="1.0.0",
    description=DESCRIPTION,
    openapi_tags=TAGS,
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def revalidate_static(request, call_next):
    """Страницы, стили и скрипты браузер всегда перепроверяет (ETag), чтобы правки вёрстки были видны сразу."""
    response = await call_next(request)
    if not request.url.path.startswith("/api") and "cache-control" not in response.headers:
        response.headers["Cache-Control"] = "no-cache"
    return response


for r in (auth.router, events.router, me.router, organizer.router, meta.router):
    app.include_router(r)


@app.get("/api/health", tags=["Справочники"], summary="Проверка работоспособности")
def health():
    return {"status": "ok"}


# Фронтенд раздаётся тем же сервером — фронт и бэк на одном origin.
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
