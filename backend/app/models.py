from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class UserRole(str, enum.Enum):
    student = "student"
    organizer = "organizer"
    admin = "admin"


class EventStatus(str, enum.Enum):
    draft = "draft"
    published = "published"
    cancelled = "cancelled"
    finished = "finished"


class RegistrationStatus(str, enum.Enum):
    registered = "registered"   
    waitlist = "waitlist"       
    cancelled = "cancelled"     
    attended = "attended"       


class NotificationType(str, enum.Enum):
    reminder = "reminder"                   
    event_changed = "event_changed"         
    event_cancelled = "event_cancelled"
    waitlist_promoted = "waitlist_promoted" 
    registration = "registration"           
    review_request = "review_request"       


def _now() -> datetime:
    return datetime.now().replace(microsecond=0)


class Faculty(Base):
    """Институт / факультет университета."""

    __tablename__ = "faculties"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), unique=True)
    short_name: Mapped[str] = mapped_column(String(30))

    users: Mapped[list[User]] = relationship(back_populates="faculty")
    events: Mapped[list[Event]] = relationship(back_populates="faculty")


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    full_name: Mapped[str] = mapped_column(String(200))
    role: Mapped[UserRole] = mapped_column(Enum(UserRole), default=UserRole.student)
    faculty_id: Mapped[int | None] = mapped_column(ForeignKey("faculties.id", ondelete="SET NULL"))
    student_group: Mapped[str | None] = mapped_column(String(50))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    faculty: Mapped[Faculty | None] = relationship(back_populates="users")
    organized_events: Mapped[list[Event]] = relationship(back_populates="organizer")
    registrations: Mapped[list[Registration]] = relationship(back_populates="user")
    reviews: Mapped[list[Review]] = relationship(back_populates="user")
    notifications: Mapped[list[Notification]] = relationship(back_populates="user")


class Category(Base):
    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    slug: Mapped[str] = mapped_column(String(100), unique=True)
    icon: Mapped[str] = mapped_column(String(50), default="bi-calendar-event")
    color: Mapped[str] = mapped_column(String(20), default="#4f46e5")

    events: Mapped[list[Event]] = relationship(back_populates="category")


class Tag(Base):
    __tablename__ = "tags"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(60), unique=True)

    event_links: Mapped[list[EventTag]] = relationship(back_populates="tag", cascade="all, delete-orphan")


class Venue(Base):
    """Место проведения: аудитория, зал, стадион."""

    __tablename__ = "venues"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    building: Mapped[str] = mapped_column(String(100))
    room: Mapped[str | None] = mapped_column(String(50))
    address: Mapped[str] = mapped_column(String(255))
    capacity: Mapped[int] = mapped_column(Integer, default=0)

    events: Mapped[list[Event]] = relationship(back_populates="venue")


class Event(Base):
    __tablename__ = "events"
    __table_args__ = (
        CheckConstraint("capacity > 0", name="ck_event_capacity_positive"),
        CheckConstraint("end_at > start_at", name="ck_event_dates"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(200), index=True)
    short_description: Mapped[str] = mapped_column(String(300))
    description: Mapped[str] = mapped_column(Text)
    category_id: Mapped[int] = mapped_column(ForeignKey("categories.id"))
    venue_id: Mapped[int] = mapped_column(ForeignKey("venues.id"))
    organizer_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    faculty_id: Mapped[int | None] = mapped_column(ForeignKey("faculties.id", ondelete="SET NULL"))
    start_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    end_at: Mapped[datetime] = mapped_column(DateTime)
    registration_deadline: Mapped[datetime | None] = mapped_column(DateTime)
    capacity: Mapped[int] = mapped_column(Integer)
    status: Mapped[EventStatus] = mapped_column(Enum(EventStatus), default=EventStatus.draft, index=True)
    cover_url: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)

    category: Mapped[Category] = relationship(back_populates="events")
    venue: Mapped[Venue] = relationship(back_populates="events")
    organizer: Mapped[User] = relationship(back_populates="organized_events")
    faculty: Mapped[Faculty | None] = relationship(back_populates="events")
    tag_links: Mapped[list[EventTag]] = relationship(back_populates="event", cascade="all, delete-orphan")
    program: Mapped[list[ProgramItem]] = relationship(
        back_populates="event", cascade="all, delete-orphan", order_by="ProgramItem.start_at"
    )
    registrations: Mapped[list[Registration]] = relationship(back_populates="event", cascade="all, delete-orphan")
    reviews: Mapped[list[Review]] = relationship(back_populates="event", cascade="all, delete-orphan")

    @property
    def tags(self) -> list[Tag]:
        return [link.tag for link in self.tag_links]


class EventTag(Base):
    """Связь «многие ко многим» между мероприятиями и тегами."""

    __tablename__ = "event_tags"

    event_id: Mapped[int] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), primary_key=True)
    tag_id: Mapped[int] = mapped_column(ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True)

    event: Mapped[Event] = relationship(back_populates="tag_links")
    tag: Mapped[Tag] = relationship(back_populates="event_links")


class ProgramItem(Base):
    """Пункт программы мероприятия (доклад, секция, перерыв)."""

    __tablename__ = "program_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), index=True)
    start_at: Mapped[datetime] = mapped_column(DateTime)
    title: Mapped[str] = mapped_column(String(200))
    speaker: Mapped[str | None] = mapped_column(String(200))

    event: Mapped[Event] = relationship(back_populates="program")


class Registration(Base):
    __tablename__ = "registrations"
    __table_args__ = (UniqueConstraint("event_id", "user_id", name="uq_registration_event_user"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    status: Mapped[RegistrationStatus] = mapped_column(Enum(RegistrationStatus), index=True)
    waitlist_position: Mapped[int | None] = mapped_column(Integer)
    qr_token: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)

    event: Mapped[Event] = relationship(back_populates="registrations")
    user: Mapped[User] = relationship(back_populates="registrations")
    check_in: Mapped[CheckIn | None] = relationship(
        back_populates="registration", cascade="all, delete-orphan", uselist=False
    )


class CheckIn(Base):
    """Факт посещения: вход подтверждён сканированием QR-кода."""

    __tablename__ = "check_ins"

    id: Mapped[int] = mapped_column(primary_key=True)
    registration_id: Mapped[int] = mapped_column(
        ForeignKey("registrations.id", ondelete="CASCADE"), unique=True
    )
    checked_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    checked_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    registration: Mapped[Registration] = relationship(back_populates="check_in")
    checked_by: Mapped[User | None] = relationship()


class Review(Base):
    __tablename__ = "reviews"
    __table_args__ = (
        UniqueConstraint("event_id", "user_id", name="uq_review_event_user"),
        CheckConstraint("rating BETWEEN 1 AND 5", name="ck_review_rating"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    rating: Mapped[int] = mapped_column(Integer)
    comment: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    event: Mapped[Event] = relationship(back_populates="reviews")
    user: Mapped[User] = relationship(back_populates="reviews")


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    event_id: Mapped[int | None] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"))
    type: Mapped[NotificationType] = mapped_column(Enum(NotificationType))
    title: Mapped[str] = mapped_column(String(200))
    message: Mapped[str] = mapped_column(Text)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    user: Mapped[User] = relationship(back_populates="notifications")
    event: Mapped[Event | None] = relationship()


class Favorite(Base):
    """Избранные мероприятия пользователя."""

    __tablename__ = "favorites"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
