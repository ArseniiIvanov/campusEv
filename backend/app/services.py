"""Бизнес-логика: статистика мероприятий, лист ожидания, уведомления."""
import secrets
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import schemas
from .models import (
    Event,
    EventStatus,
    Favorite,
    Notification,
    NotificationType,
    Registration,
    RegistrationStatus,
    Review,
    User,
)

ACTIVE_STATUSES = (RegistrationStatus.registered, RegistrationStatus.attended)


def now() -> datetime:
    return datetime.now().replace(microsecond=0)


def new_qr_token() -> str:
    return secrets.token_urlsafe(24)


# ---------- Статистика ----------

def event_counters(db: Session, event_ids: list[int]) -> dict[int, dict]:
    """Количество регистраций, ожидающих и рейтинг для набора мероприятий одним запросом на метрику."""
    result = {eid: {"registered": 0, "waitlist": 0, "rating": None, "reviews": 0} for eid in event_ids}
    if not event_ids:
        return result

    rows = db.execute(
        select(Registration.event_id, Registration.status, func.count())
        .where(Registration.event_id.in_(event_ids))
        .group_by(Registration.event_id, Registration.status)
    )
    for event_id, status, count in rows:
        if status in ACTIVE_STATUSES:
            result[event_id]["registered"] += count
        elif status == RegistrationStatus.waitlist:
            result[event_id]["waitlist"] += count

    rows = db.execute(
        select(Review.event_id, func.avg(Review.rating), func.count())
        .where(Review.event_id.in_(event_ids))
        .group_by(Review.event_id)
    )
    for event_id, avg, count in rows:
        result[event_id]["rating"] = round(float(avg), 1)
        result[event_id]["reviews"] = count
    return result


def favorite_ids(db: Session, user: User | None, event_ids: list[int]) -> set[int]:
    if user is None or not event_ids:
        return set()
    return set(
        db.scalars(
            select(Favorite.event_id).where(Favorite.user_id == user.id, Favorite.event_id.in_(event_ids))
        )
    )


def to_short(event: Event, counters: dict, favorites: set[int] | None = None) -> schemas.EventShort:
    c = counters.get(event.id, {"registered": 0, "waitlist": 0, "rating": None, "reviews": 0})
    data = schemas.EventShort.model_validate(event).model_dump()
    data.update(
        registered_count=c["registered"],
        waitlist_count=c["waitlist"],
        seats_left=max(event.capacity - c["registered"], 0),
        rating=c["rating"],
        reviews_count=c["reviews"],
        is_favorite=bool(favorites and event.id in favorites),
    )
    return schemas.EventShort(**data)


def serialize_events(db: Session, events: list[Event], user: User | None = None) -> list[schemas.EventShort]:
    ids = [e.id for e in events]
    counters = event_counters(db, ids)
    favs = favorite_ids(db, user, ids)
    return [to_short(e, counters, favs) for e in events]


def is_registration_open(event: Event) -> bool:
    if event.status != EventStatus.published:
        return False
    deadline = event.registration_deadline or event.start_at
    return now() < deadline


def active_count(db: Session, event_id: int) -> int:
    return db.scalar(
        select(func.count())
        .select_from(Registration)
        .where(Registration.event_id == event_id, Registration.status.in_(ACTIVE_STATUSES))
    ) or 0


# ---------- Уведомления ----------

def notify(
    db: Session,
    user_id: int,
    type_: NotificationType,
    title: str,
    message: str,
    event_id: int | None = None,
) -> Notification:
    n = Notification(user_id=user_id, type=type_, title=title, message=message, event_id=event_id)
    db.add(n)
    return n


def notify_participants(db: Session, event: Event, type_: NotificationType, title: str, message: str) -> int:
    """Рассылает уведомление всем, кто зарегистрирован или ждёт место."""
    users = db.scalars(
        select(Registration.user_id).where(
            Registration.event_id == event.id,
            Registration.status.in_((*ACTIVE_STATUSES, RegistrationStatus.waitlist)),
        )
    ).all()
    for uid in users:
        notify(db, uid, type_, title, message, event.id)
    return len(users)


def generate_reminders(db: Session, user: User) -> None:
    """Создаёт напоминания о мероприятиях в ближайшие 24 часа и просьбы об отзыве.

    Вызывается при запросе уведомлений — так система работает без фонового планировщика,
    а повторные напоминания не создаются благодаря проверке на существование.
    """
    current = now()
    regs = db.scalars(
        select(Registration)
        .join(Event)
        .where(
            Registration.user_id == user.id,
            Registration.status.in_(ACTIVE_STATUSES),
            Event.status != EventStatus.cancelled,
        )
    ).all()

    existing = {
        (n.event_id, n.type)
        for n in db.scalars(
            select(Notification).where(
                Notification.user_id == user.id,
                Notification.type.in_((NotificationType.reminder, NotificationType.review_request)),
            )
        )
    }

    reviewed = set(db.scalars(select(Review.event_id).where(Review.user_id == user.id)))

    for reg in regs:
        ev = reg.event
        if current <= ev.start_at <= current + timedelta(hours=24) and (ev.id, NotificationType.reminder) not in existing:
            notify(
                db, user.id, NotificationType.reminder,
                f"Скоро: {ev.title}",
                f"Мероприятие начнётся {ev.start_at:%d.%m в %H:%M}, {ev.venue.name}. Не забудьте QR-код для входа.",
                ev.id,
            )
        if (
            reg.status == RegistrationStatus.attended
            and ev.end_at < current
            and ev.id not in reviewed
            and (ev.id, NotificationType.review_request) not in existing
        ):
            notify(
                db, user.id, NotificationType.review_request,
                f"Как прошло «{ev.title}»?",
                "Поставьте оценку и оставьте отзыв — это поможет организаторам.",
                ev.id,
            )
    db.commit()


# ---------- Лист ожидания ----------

def renumber_waitlist(db: Session, event_id: int) -> None:
    waiting = db.scalars(
        select(Registration)
        .where(Registration.event_id == event_id, Registration.status == RegistrationStatus.waitlist)
        .order_by(Registration.waitlist_position, Registration.created_at)
    ).all()
    for pos, reg in enumerate(waiting, start=1):
        reg.waitlist_position = pos


def promote_from_waitlist(db: Session, event: Event) -> list[Registration]:
    """Переводит людей из листа ожидания в участники, пока есть свободные места."""
    promoted = []
    free = event.capacity - active_count(db, event.id)
    if free <= 0:
        return promoted
    waiting = db.scalars(
        select(Registration)
        .where(Registration.event_id == event.id, Registration.status == RegistrationStatus.waitlist)
        .order_by(Registration.waitlist_position, Registration.created_at)
        .limit(free)
    ).all()
    for reg in waiting:
        reg.status = RegistrationStatus.registered
        reg.waitlist_position = None
        promoted.append(reg)
        notify(
            db, reg.user_id, NotificationType.waitlist_promoted,
            "Место освободилось!",
            f"Вы переведены из листа ожидания в участники «{event.title}». QR-код для входа — в разделе «Мои мероприятия».",
            event.id,
        )
    db.flush()
    renumber_waitlist(db, event.id)
    return promoted
