"""Pydantic-схемы запросов и ответов API."""
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator

from .models import EventStatus, NotificationType, RegistrationStatus, UserRole


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------- Справочники ----------

class FacultyOut(ORMModel):
    id: int
    name: str
    short_name: str


class CategoryOut(ORMModel):
    id: int
    name: str
    slug: str
    icon: str
    color: str
    events_count: int = 0


class TagOut(ORMModel):
    id: int
    name: str


class VenueOut(ORMModel):
    id: int
    name: str
    building: str
    room: str | None
    address: str
    capacity: int


# ---------- Пользователи и авторизация ----------

class UserOut(ORMModel):
    id: int
    email: str
    full_name: str
    role: UserRole
    faculty: FacultyOut | None = None
    student_group: str | None = None


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)
    full_name: str = Field(min_length=2, max_length=200)
    faculty_id: int | None = None
    student_group: str | None = Field(default=None, max_length=50)


class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


# ---------- Мероприятия ----------

class ProgramItemIn(BaseModel):
    start_at: datetime
    title: str = Field(min_length=1, max_length=200)
    speaker: str | None = Field(default=None, max_length=200)


class ProgramItemOut(ORMModel):
    id: int
    start_at: datetime
    title: str
    speaker: str | None


class OrganizerOut(ORMModel):
    id: int
    full_name: str


class EventShort(ORMModel):
    """Карточка мероприятия в каталоге."""

    id: int
    title: str
    short_description: str
    start_at: datetime
    end_at: datetime
    status: EventStatus
    capacity: int
    cover_url: str | None
    category: CategoryOut
    venue: VenueOut
    faculty: FacultyOut | None
    tags: list[TagOut]
    registered_count: int = 0
    waitlist_count: int = 0
    seats_left: int = 0
    rating: float | None = None
    reviews_count: int = 0
    is_favorite: bool = False


class MyRegistrationBrief(ORMModel):
    id: int
    status: RegistrationStatus
    waitlist_position: int | None
    qr_token: str


class EventDetail(EventShort):
    description: str
    registration_deadline: datetime | None
    organizer: OrganizerOut
    program: list[ProgramItemOut]
    registration_open: bool = True
    my_registration: MyRegistrationBrief | None = None
    can_review: bool = False


class EventPage(BaseModel):
    items: list[EventShort]
    total: int
    page: int
    page_size: int
    pages: int


class EventIn(BaseModel):
    title: str = Field(min_length=3, max_length=200)
    short_description: str = Field(min_length=3, max_length=300)
    description: str = Field(min_length=3)
    category_id: int
    venue_id: int
    faculty_id: int | None = None
    start_at: datetime
    end_at: datetime
    registration_deadline: datetime | None = None
    capacity: int = Field(gt=0, le=10000)
    cover_url: str | None = None
    tags: list[str] = Field(default_factory=list, description="Названия тегов; новые создаются автоматически")
    program: list[ProgramItemIn] = Field(default_factory=list)
    publish: bool = True

    @model_validator(mode="after")
    def _check_dates(self):
        if self.end_at <= self.start_at:
            raise ValueError("Окончание должно быть позже начала")
        if self.registration_deadline and self.registration_deadline > self.start_at:
            raise ValueError("Регистрация должна закрываться не позже начала мероприятия")
        return self


# ---------- Регистрации ----------

class RegistrationOut(ORMModel):
    id: int
    status: RegistrationStatus
    waitlist_position: int | None
    qr_token: str
    created_at: datetime
    checked_in_at: datetime | None = None
    has_review: bool = False
    event: EventShort


class RegistrationResult(BaseModel):
    registration: MyRegistrationBrief
    message: str


class ParticipantOut(BaseModel):
    registration_id: int
    user_id: int
    full_name: str
    email: str
    student_group: str | None
    faculty: str | None
    status: RegistrationStatus
    waitlist_position: int | None
    registered_at: datetime
    checked_in_at: datetime | None


class ParticipantStatusUpdate(BaseModel):
    status: RegistrationStatus


class CheckInRequest(BaseModel):
    qr_token: str = Field(min_length=8, max_length=64)
    event_id: int | None = Field(default=None, description="Если указан — проверяется, что QR относится к этому мероприятию")


class CheckInResult(BaseModel):
    ok: bool
    message: str
    participant: str
    event_title: str
    checked_in_at: datetime


# ---------- Отзывы ----------

class ReviewIn(BaseModel):
    rating: int = Field(ge=1, le=5)
    comment: str | None = Field(default=None, max_length=2000)


class ReviewOut(ORMModel):
    id: int
    rating: int
    comment: str | None
    created_at: datetime
    author: str


class ReviewsPage(BaseModel):
    items: list[ReviewOut]
    average: float | None
    count: int
    distribution: dict[int, int]


# ---------- Уведомления ----------

class NotificationOut(ORMModel):
    id: int
    type: NotificationType
    title: str
    message: str
    is_read: bool
    created_at: datetime
    event_id: int | None


class NotificationsList(BaseModel):
    items: list[NotificationOut]
    unread: int


# ---------- Кабинет организатора ----------

class OrganizerEventStats(BaseModel):
    event: EventShort
    attended_count: int
    cancelled_count: int
    fill_rate: float


class OrganizerDashboard(BaseModel):
    events_total: int
    upcoming_total: int
    registrations_total: int
    attended_total: int
    average_rating: float | None
    events: list[OrganizerEventStats]


class StatsOut(BaseModel):
    events_upcoming: int
    registrations_total: int
    organizers_total: int
    categories_total: int
