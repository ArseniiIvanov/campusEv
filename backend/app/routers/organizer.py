"""Кабинет организатора: статистика, участники, подтверждение входа по QR-коду."""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from .. import schemas
from ..auth import require_organizer
from ..database import get_db
from ..models import (
    CheckIn,
    Event,
    EventTag,
    Registration,
    RegistrationStatus,
    Review,
    User,
    UserRole,
)
from ..services import active_count, now, promote_from_waitlist, renumber_waitlist, serialize_events

router = APIRouter(prefix="/api/organizer", tags=["Кабинет организатора"])


def _own_event(db: Session, event_id: int, user: User) -> Event:
    event = db.get(Event, event_id)
    if event is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Мероприятие не найдено")
    if user.role != UserRole.admin and event.organizer_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Вы не организатор этого мероприятия")
    return event


@router.get("/dashboard", response_model=schemas.OrganizerDashboard, summary="Мои мероприятия и статистика регистраций")
def dashboard(user: User = Depends(require_organizer), db: Session = Depends(get_db)):
    stmt = (
        select(Event)
        .options(
            selectinload(Event.category), selectinload(Event.venue), selectinload(Event.faculty),
            selectinload(Event.tag_links).selectinload(EventTag.tag),
        )
        .order_by(Event.start_at.desc())
    )
    if user.role != UserRole.admin:
        stmt = stmt.where(Event.organizer_id == user.id)
    events = list(db.scalars(stmt).all())
    ids = [e.id for e in events]
    short = serialize_events(db, events, user)

    by_status: dict[int, dict] = {i: {} for i in ids}
    if ids:
        for event_id, st, cnt in db.execute(
            select(Registration.event_id, Registration.status, func.count())
            .where(Registration.event_id.in_(ids))
            .group_by(Registration.event_id, Registration.status)
        ):
            by_status[event_id][st] = cnt

    rows = []
    for ev, s in zip(events, short):
        st = by_status.get(ev.id, {})
        rows.append(
            schemas.OrganizerEventStats(
                event=s,
                attended_count=st.get(RegistrationStatus.attended, 0),
                cancelled_count=st.get(RegistrationStatus.cancelled, 0),
                fill_rate=round(s.registered_count / ev.capacity * 100, 1) if ev.capacity else 0,
            )
        )

    avg = db.scalar(select(func.avg(Review.rating)).where(Review.event_id.in_(ids))) if ids else None
    return schemas.OrganizerDashboard(
        events_total=len(events),
        upcoming_total=sum(1 for e in events if e.start_at >= now()),
        registrations_total=sum(s.registered_count for s in short),
        attended_total=sum(r.attended_count for r in rows),
        average_rating=round(float(avg), 1) if avg else None,
        events=rows,
    )


@router.get(
    "/events/{event_id}/participants",
    response_model=list[schemas.ParticipantOut],
    summary="Участники мероприятия",
)
def participants(event_id: int, user: User = Depends(require_organizer), db: Session = Depends(get_db)):
    _own_event(db, event_id, user)
    regs = db.scalars(
        select(Registration)
        .options(selectinload(Registration.user).selectinload(User.faculty), selectinload(Registration.check_in))
        .where(Registration.event_id == event_id)
        .order_by(Registration.status, Registration.waitlist_position, Registration.created_at)
    ).all()
    return [
        schemas.ParticipantOut(
            registration_id=r.id,
            user_id=r.user_id,
            full_name=r.user.full_name,
            email=r.user.email,
            student_group=r.user.student_group,
            faculty=r.user.faculty.short_name if r.user.faculty else None,
            status=r.status,
            waitlist_position=r.waitlist_position,
            registered_at=r.created_at,
            checked_in_at=r.check_in.checked_at if r.check_in else None,
        )
        for r in regs
    ]


@router.patch(
    "/registrations/{registration_id}",
    response_model=schemas.ParticipantOut,
    summary="Изменить статус участника (подтвердить, отменить)",
)
def update_participant(
    registration_id: int,
    data: schemas.ParticipantStatusUpdate,
    user: User = Depends(require_organizer),
    db: Session = Depends(get_db),
):
    reg = db.get(Registration, registration_id)
    if reg is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Регистрация не найдена")
    event = _own_event(db, reg.event_id, user)
    if data.status == RegistrationStatus.attended:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Посещение отмечается через сканирование QR-кода")
    if data.status == RegistrationStatus.waitlist:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Перевести в лист ожидания вручную нельзя")

    if (
        data.status == RegistrationStatus.registered
        and reg.status != RegistrationStatus.registered
        and active_count(db, event.id) >= event.capacity
    ):
        raise HTTPException(status.HTTP_409_CONFLICT, "Свободных мест нет — сначала увеличьте лимит участников")

    reg.status = data.status
    reg.waitlist_position = None
    db.flush()
    promote_from_waitlist(db, event)
    renumber_waitlist(db, event.id)
    db.commit()
    return next(p for p in participants(event.id, user, db) if p.registration_id == reg.id)


@router.post("/check-in", response_model=schemas.CheckInResult, summary="Подтвердить вход по QR-коду")
def check_in(data: schemas.CheckInRequest, user: User = Depends(require_organizer), db: Session = Depends(get_db)):
    token = data.qr_token.strip().removeprefix("CAMPUSEVENTS:")
    reg = db.scalar(
        select(Registration)
        .options(selectinload(Registration.user), selectinload(Registration.event), selectinload(Registration.check_in))
        .where(Registration.qr_token == token)
    )
    if reg is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "QR-код не найден")
    _own_event(db, reg.event_id, user)
    if data.event_id is not None and reg.event_id != data.event_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"QR-код относится к другому мероприятию: «{reg.event.title}»")
    if reg.status == RegistrationStatus.attended and reg.check_in:
        return schemas.CheckInResult(
            ok=False, message="Вход уже был подтверждён ранее", participant=reg.user.full_name,
            event_title=reg.event.title, checked_in_at=reg.check_in.checked_at,
        )
    if reg.status != RegistrationStatus.registered:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Регистрация не активна (лист ожидания или отменена)")

    reg.status = RegistrationStatus.attended
    reg.check_in = CheckIn(checked_by_id=user.id, checked_at=now())
    db.commit()
    return schemas.CheckInResult(
        ok=True, message="Вход подтверждён", participant=reg.user.full_name,
        event_title=reg.event.title, checked_in_at=reg.check_in.checked_at,
    )
