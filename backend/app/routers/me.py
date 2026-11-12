"""Личный кабинет участника: мои мероприятия, QR-коды, календарь, уведомления, избранное."""
import io
from typing import Literal

import qrcode
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session, selectinload

from .. import schemas
from ..auth import get_current_user
from ..database import get_db
from ..models import Event, EventTag, Favorite, Notification, Registration, RegistrationStatus, Review, User
from ..services import generate_reminders, now, serialize_events

router = APIRouter(prefix="/api/me", tags=["Личный кабинет участника"])


@router.get(
    "/registrations",
    response_model=list[schemas.RegistrationOut],
    summary="Мои мероприятия: предстоящие, история посещений или все",
)
def my_registrations(
    scope: Literal["upcoming", "past", "all"] = "upcoming",
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    stmt = (
        select(Registration)
        .join(Event)
        .options(
            selectinload(Registration.check_in),
            selectinload(Registration.event).selectinload(Event.category),
            selectinload(Registration.event).selectinload(Event.venue),
            selectinload(Registration.event).selectinload(Event.faculty),
            selectinload(Registration.event).selectinload(Event.tag_links).selectinload(EventTag.tag),
        )
        .where(Registration.user_id == user.id, Registration.status != RegistrationStatus.cancelled)
    )
    if scope == "upcoming":
        stmt = stmt.where(Event.end_at >= now()).order_by(Event.start_at)
    elif scope == "past":
        stmt = stmt.where(Event.end_at < now()).order_by(Event.start_at.desc())
    else:
        stmt = stmt.order_by(Event.start_at)

    regs = db.scalars(stmt).all()
    events = serialize_events(db, [r.event for r in regs], user)
    reviewed = set(db.scalars(select(Review.event_id).where(Review.user_id == user.id)))
    return [
        schemas.RegistrationOut(
            id=r.id,
            status=r.status,
            waitlist_position=r.waitlist_position,
            qr_token=r.qr_token,
            created_at=r.created_at,
            checked_in_at=r.check_in.checked_at if r.check_in else None,
            has_review=r.event_id in reviewed,
            event=ev,
        )
        for r, ev in zip(regs, events)
    ]


@router.get(
    "/registrations/{registration_id}/qr",
    summary="QR-код для входа (PNG)",
    responses={200: {"content": {"image/png": {}}}},
    response_class=Response,
)
def registration_qr(registration_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    reg = db.get(Registration, registration_id)
    if reg is None or reg.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Регистрация не найдена")
    if reg.status not in (RegistrationStatus.registered, RegistrationStatus.attended):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "QR-код выдаётся только подтверждённым участникам")

    img = qrcode.make(f"CAMPUSEVENTS:{reg.qr_token}", box_size=10, border=2)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return Response(content=buf.getvalue(), media_type="image/png", headers={"Cache-Control": "private, max-age=300"})


@router.get("/favorites", response_model=list[schemas.EventShort], summary="Избранные мероприятия")
def my_favorites(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    events = db.scalars(
        select(Event)
        .join(Favorite, Favorite.event_id == Event.id)
        .options(
            selectinload(Event.category), selectinload(Event.venue), selectinload(Event.faculty),
            selectinload(Event.tag_links).selectinload(EventTag.tag),
        )
        .where(Favorite.user_id == user.id)
        .order_by(Event.start_at)
    ).all()
    return serialize_events(db, list(events), user)


@router.get("/notifications", response_model=schemas.NotificationsList, summary="Уведомления")
def my_notifications(
    limit: int = Query(30, ge=1, le=100),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    generate_reminders(db, user)
    items = db.scalars(
        select(Notification)
        .where(Notification.user_id == user.id)
        .order_by(Notification.created_at.desc(), Notification.id.desc())
        .limit(limit)
    ).all()
    unread = db.scalar(
        select(func.count()).select_from(Notification).where(Notification.user_id == user.id, Notification.is_read.is_(False))
    ) or 0
    return schemas.NotificationsList(items=items, unread=unread)


@router.post("/notifications/read-all", status_code=status.HTTP_204_NO_CONTENT, summary="Отметить все уведомления прочитанными")
def read_all(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.execute(update(Notification).where(Notification.user_id == user.id).values(is_read=True))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/notifications/{notification_id}/read", status_code=status.HTTP_204_NO_CONTENT, summary="Отметить уведомление прочитанным")
def read_one(notification_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    n = db.get(Notification, notification_id)
    if n is None or n.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Уведомление не найдено")
    n.is_read = True
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
