import math
from datetime import date, datetime, time, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from .. import schemas
from ..auth import get_current_user, get_current_user_optional, require_organizer
from ..database import get_db
from ..models import (
    Category,
    Event,
    EventStatus,
    EventTag,
    Favorite,
    NotificationType,
    ProgramItem,
    Registration,
    RegistrationStatus,
    Review,
    Tag,
    User,
    UserRole,
    Venue,
)
from ..services import (
    ACTIVE_STATUSES,
    active_count,
    event_counters,
    favorite_ids,
    is_registration_open,
    new_qr_token,
    notify,
    notify_participants,
    now,
    promote_from_waitlist,
    renumber_waitlist,
    serialize_events,
    to_short,
)

router = APIRouter(prefix="/api/events", tags=["Мероприятия"])

EVENT_LOAD = (
    selectinload(Event.category),
    selectinload(Event.venue),
    selectinload(Event.faculty),
    selectinload(Event.tag_links).selectinload(EventTag.tag),
)


def _get_event(db: Session, event_id: int) -> Event:
    event = db.scalar(
        select(Event)
        .options(*EVENT_LOAD, selectinload(Event.program), selectinload(Event.organizer))
        .where(Event.id == event_id)
    )
    if event is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Мероприятие не найдено")
    return event


def _ensure_owner(event: Event, user: User) -> None:
    if user.role != UserRole.admin and event.organizer_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Вы не организатор этого мероприятия")


@router.get("", response_model=schemas.EventPage, summary="Каталог мероприятий с фильтрами")
def list_events(
    q: str | None = Query(None, description="Поиск по названию и описанию"),
    category: str | None = Query(None, description="slug категории"),
    tag: str | None = Query(None, description="Название тега"),
    faculty_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    only_available: bool = Query(False, description="Только с открытой регистрацией и свободными местами"),
    include_past: bool = False,
    sort: Literal["date", "popular", "rating"] = "date",
    page: int = Query(1, ge=1),
    page_size: int = Query(9, ge=1, le=50),
    user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
):
    active_sub = (
        select(Registration.event_id, func.count().label("cnt"))
        .where(Registration.status.in_(ACTIVE_STATUSES))
        .group_by(Registration.event_id)
        .subquery()
    )
    rating_sub = (
        select(Review.event_id, func.avg(Review.rating).label("avg"))
        .group_by(Review.event_id)
        .subquery()
    )
    taken = func.coalesce(active_sub.c.cnt, 0)

    stmt = (
        select(Event)
        .outerjoin(active_sub, active_sub.c.event_id == Event.id)
        .outerjoin(rating_sub, rating_sub.c.event_id == Event.id)
        .where(Event.status.in_((EventStatus.published, EventStatus.finished)))
    )
    if not include_past:
        stmt = stmt.where(Event.end_at >= now())
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Event.title.ilike(like), Event.short_description.ilike(like), Event.description.ilike(like)))
    if category:
        stmt = stmt.join(Category).where(Category.slug == category)
    if tag:
        stmt = stmt.where(Event.tag_links.any(EventTag.tag.has(Tag.name == tag)))
    if faculty_id:
        stmt = stmt.where(Event.faculty_id == faculty_id)
    if date_from:
        stmt = stmt.where(Event.start_at >= datetime.combine(date_from, time.min))
    if date_to:
        stmt = stmt.where(Event.start_at < datetime.combine(date_to + timedelta(days=1), time.min))
    if only_available:
        stmt = stmt.where(
            Event.status == EventStatus.published,
            taken < Event.capacity,
            func.coalesce(Event.registration_deadline, Event.start_at) > now(),
        )

    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0

    if sort == "popular":
        stmt = stmt.order_by(taken.desc(), Event.start_at)
    elif sort == "rating":
        stmt = stmt.order_by(func.coalesce(rating_sub.c.avg, 0).desc(), Event.start_at)
    else:
        stmt = stmt.order_by(Event.start_at)

    events = db.scalars(stmt.options(*EVENT_LOAD).offset((page - 1) * page_size).limit(page_size)).all()
    return schemas.EventPage(
        items=serialize_events(db, list(events), user),
        total=total,
        page=page,
        page_size=page_size,
        pages=max(math.ceil(total / page_size), 1),
    )


@router.get("/{event_id}", response_model=schemas.EventDetail, summary="Карточка мероприятия")
def get_event(
    event_id: int,
    user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
):
    event = _get_event(db, event_id)
    if event.status == EventStatus.draft and (user is None or (user.id != event.organizer_id and user.role != UserRole.admin)):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Мероприятие не найдено")

    counters = event_counters(db, [event.id])
    short = to_short(event, counters, favorite_ids(db, user, [event.id]))
    detail = schemas.EventDetail(
        **short.model_dump(),
        description=event.description,
        registration_deadline=event.registration_deadline,
        organizer=schemas.OrganizerOut.model_validate(event.organizer),
        program=[schemas.ProgramItemOut.model_validate(p) for p in event.program],
        registration_open=is_registration_open(event),
    )
    if user:
        reg = db.scalar(select(Registration).where(Registration.event_id == event.id, Registration.user_id == user.id))
        if reg and reg.status != RegistrationStatus.cancelled:
            detail.my_registration = schemas.MyRegistrationBrief.model_validate(reg)
            has_review = db.scalar(select(Review.id).where(Review.event_id == event.id, Review.user_id == user.id))
            detail.can_review = reg.status == RegistrationStatus.attended and event.end_at < now() and not has_review
    return detail


# ---------- Регистрация ----------

@router.post(
    "/{event_id}/register",
    response_model=schemas.RegistrationResult,
    status_code=status.HTTP_201_CREATED,
    summary="Записаться на мероприятие (или встать в лист ожидания)",
)
def register_for_event(event_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    event = _get_event(db, event_id)
    if not is_registration_open(event):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Регистрация на это мероприятие закрыта")

    reg = db.scalar(select(Registration).where(Registration.event_id == event.id, Registration.user_id == user.id))
    if reg and reg.status != RegistrationStatus.cancelled:
        raise HTTPException(status.HTTP_409_CONFLICT, "Вы уже записаны на это мероприятие")

    has_seat = active_count(db, event.id) < event.capacity
    if reg is None:
        reg = Registration(event_id=event.id, user_id=user.id, qr_token=new_qr_token())
        db.add(reg)
    else:
        reg.qr_token = new_qr_token()
        reg.created_at = now()

    if has_seat:
        reg.status = RegistrationStatus.registered
        reg.waitlist_position = None
        message = "Место за вами — покажите QR-код на входе."
        notify(db, user.id, NotificationType.registration, "Регистрация подтверждена",
               f"Вы записаны на «{event.title}» ({event.start_at:%d.%m.%Y %H:%M}).", event.id)
    else:
        last = db.scalar(
            select(func.max(Registration.waitlist_position)).where(
                Registration.event_id == event.id, Registration.status == RegistrationStatus.waitlist
            )
        ) or 0
        reg.status = RegistrationStatus.waitlist
        reg.waitlist_position = last + 1
        message = f"Мест нет — вы в листе ожидания под номером {last + 1}. Мы сообщим, когда место освободится."
        notify(db, user.id, NotificationType.registration, "Вы в листе ожидания",
               f"«{event.title}»: ваша позиция в очереди — {last + 1}.", event.id)

    db.commit()
    db.refresh(reg)
    return schemas.RegistrationResult(registration=schemas.MyRegistrationBrief.model_validate(reg), message=message)


@router.delete(
    "/{event_id}/register",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Отменить регистрацию",
)
def cancel_registration(event_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    event = _get_event(db, event_id)
    reg = db.scalar(select(Registration).where(Registration.event_id == event.id, Registration.user_id == user.id))
    if reg is None or reg.status == RegistrationStatus.cancelled:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Регистрация не найдена")
    if reg.status == RegistrationStatus.attended:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Вы уже посетили мероприятие")

    was_registered = reg.status == RegistrationStatus.registered
    reg.status = RegistrationStatus.cancelled
    reg.waitlist_position = None
    db.flush()
    if was_registered:
        promote_from_waitlist(db, event)
    else:
        renumber_waitlist(db, event.id)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------- Избранное ----------

@router.put("/{event_id}/favorite", status_code=status.HTTP_204_NO_CONTENT, summary="Добавить в избранное")
def add_favorite(event_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _get_event(db, event_id)
    if db.get(Favorite, (user.id, event_id)) is None:
        db.add(Favorite(user_id=user.id, event_id=event_id))
        db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/{event_id}/favorite", status_code=status.HTTP_204_NO_CONTENT, summary="Убрать из избранного")
def remove_favorite(event_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    fav = db.get(Favorite, (user.id, event_id))
    if fav:
        db.delete(fav)
        db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------- Отзывы ----------

@router.get("/{event_id}/reviews", response_model=schemas.ReviewsPage, summary="Отзывы и рейтинг мероприятия")
def list_reviews(event_id: int, db: Session = Depends(get_db)):
    _get_event(db, event_id)
    reviews = db.scalars(
        select(Review).options(selectinload(Review.user)).where(Review.event_id == event_id).order_by(Review.created_at.desc())
    ).all()
    distribution = {i: 0 for i in range(1, 6)}
    for r in reviews:
        distribution[r.rating] += 1
    avg = round(sum(r.rating for r in reviews) / len(reviews), 1) if reviews else None
    return schemas.ReviewsPage(
        items=[
            schemas.ReviewOut(id=r.id, rating=r.rating, comment=r.comment, created_at=r.created_at, author=r.user.full_name)
            for r in reviews
        ],
        average=avg,
        count=len(reviews),
        distribution=distribution,
    )


@router.post(
    "/{event_id}/reviews",
    response_model=schemas.ReviewOut,
    status_code=status.HTTP_201_CREATED,
    summary="Оставить отзыв (только посетившим мероприятие)",
)
def create_review(
    event_id: int,
    data: schemas.ReviewIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    event = _get_event(db, event_id)
    if event.end_at > now():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Отзыв можно оставить после окончания мероприятия")
    reg = db.scalar(select(Registration).where(Registration.event_id == event.id, Registration.user_id == user.id))
    if reg is None or reg.status != RegistrationStatus.attended:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Отзыв могут оставить только посетители мероприятия")
    if db.scalar(select(Review.id).where(Review.event_id == event.id, Review.user_id == user.id)):
        raise HTTPException(status.HTTP_409_CONFLICT, "Вы уже оставили отзыв")
    review = Review(event_id=event.id, user_id=user.id, rating=data.rating, comment=(data.comment or "").strip() or None)
    db.add(review)
    db.commit()
    db.refresh(review)
    return schemas.ReviewOut(
        id=review.id, rating=review.rating, comment=review.comment, created_at=review.created_at, author=user.full_name
    )


# ---------- Управление мероприятиями (организатор) ----------

def _apply_event_data(db: Session, event: Event, data: schemas.EventIn) -> None:
    if db.get(Category, data.category_id) is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Категория не найдена")
    venue = db.get(Venue, data.venue_id)
    if venue is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Место проведения не найдено")
    if venue.capacity and data.capacity > venue.capacity:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"Лимит участников больше вместимости площадки ({venue.capacity})",
        )
    for field in (
        "title", "short_description", "description", "category_id", "venue_id", "faculty_id",
        "start_at", "end_at", "registration_deadline", "capacity", "cover_url",
    ):
        setattr(event, field, getattr(data, field))

    event.tag_links.clear()
    db.flush()
    for name in dict.fromkeys(t.strip().lower() for t in data.tags if t.strip()):
        tag = db.scalar(select(Tag).where(Tag.name == name)) or Tag(name=name)
        event.tag_links.append(EventTag(tag=tag))

    event.program.clear()
    for item in data.program:
        event.program.append(ProgramItem(start_at=item.start_at, title=item.title, speaker=item.speaker))


@router.post(
    "",
    response_model=schemas.EventDetail,
    status_code=status.HTTP_201_CREATED,
    summary="Создать мероприятие",
)
def create_event(data: schemas.EventIn, user: User = Depends(require_organizer), db: Session = Depends(get_db)):
    event = Event(organizer_id=user.id, status=EventStatus.published if data.publish else EventStatus.draft)
    db.add(event)
    _apply_event_data(db, event, data)
    db.commit()
    return get_event(event.id, user, db)


@router.put("/{event_id}", response_model=schemas.EventDetail, summary="Изменить мероприятие (участники получат уведомление)")
def update_event(
    event_id: int,
    data: schemas.EventIn,
    user: User = Depends(require_organizer),
    db: Session = Depends(get_db),
):
    event = _get_event(db, event_id)
    _ensure_owner(event, user)
    if event.status == EventStatus.cancelled:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Мероприятие отменено")

    before = (event.start_at, event.end_at, event.venue_id, [(p.start_at, p.title, p.speaker) for p in event.program])
    _apply_event_data(db, event, data)
    if data.publish and event.status == EventStatus.draft:
        event.status = EventStatus.published
    db.flush()
    after = (event.start_at, event.end_at, event.venue_id, [(p.start_at, p.title, p.speaker) for p in event.program])

    if before != after:
        db.refresh(event, ["venue"])
        changes = []
        if before[0] != after[0] or before[1] != after[1]:
            changes.append(f"новое время: {event.start_at:%d.%m.%Y %H:%M}–{event.end_at:%H:%M}")
        if before[2] != after[2]:
            changes.append(f"новое место: {event.venue.name}")
        if before[3] != after[3]:
            changes.append("обновлена программа")
        notify_participants(
            db, event, NotificationType.event_changed,
            f"Изменения: {event.title}", "Организатор внёс изменения — " + ", ".join(changes) + ".",
        )
    promote_from_waitlist(db, event)
    db.commit()
    return get_event(event.id, user, db)


@router.post("/{event_id}/cancel", response_model=schemas.EventDetail, summary="Отменить мероприятие")
def cancel_event(event_id: int, user: User = Depends(require_organizer), db: Session = Depends(get_db)):
    event = _get_event(db, event_id)
    _ensure_owner(event, user)
    if event.status == EventStatus.cancelled:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Мероприятие уже отменено")
    event.status = EventStatus.cancelled
    notify_participants(
        db, event, NotificationType.event_cancelled,
        f"Отменено: {event.title}", "К сожалению, организатор отменил мероприятие.",
    )
    db.commit()
    return get_event(event.id, user, db)
