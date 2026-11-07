from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import schemas
from ..database import get_db
from ..models import Category, Event, EventStatus, Faculty, Registration, Tag, User, UserRole, Venue
from ..services import ACTIVE_STATUSES, now

router = APIRouter(prefix="/api", tags=["Справочники"])


@router.get("/categories", response_model=list[schemas.CategoryOut], summary="Категории с числом предстоящих мероприятий")
def categories(db: Session = Depends(get_db)):
    counts = dict(
        db.execute(
            select(Event.category_id, func.count())
            .where(Event.status == EventStatus.published, Event.end_at >= now())
            .group_by(Event.category_id)
        ).all()
    )
    result = []
    for c in db.scalars(select(Category).order_by(Category.name)):
        item = schemas.CategoryOut.model_validate(c)
        item.events_count = counts.get(c.id, 0)
        result.append(item)
    return result


@router.get("/tags", response_model=list[schemas.TagOut], summary="Все теги")
def tags(db: Session = Depends(get_db)):
    return db.scalars(select(Tag).order_by(Tag.name)).all()


@router.get("/venues", response_model=list[schemas.VenueOut], summary="Места проведения")
def venues(db: Session = Depends(get_db)):
    return db.scalars(select(Venue).order_by(Venue.name)).all()


@router.get("/faculties", response_model=list[schemas.FacultyOut], summary="Институты")
def faculties(db: Session = Depends(get_db)):
    return db.scalars(select(Faculty).order_by(Faculty.name)).all()


@router.get("/stats", response_model=schemas.StatsOut, summary="Сводная статистика для главной страницы")
def stats(db: Session = Depends(get_db)):
    return schemas.StatsOut(
        events_upcoming=db.scalar(
            select(func.count()).select_from(Event).where(Event.status == EventStatus.published, Event.start_at >= now())
        ) or 0,
        registrations_total=db.scalar(
            select(func.count()).select_from(Registration).where(Registration.status.in_(ACTIVE_STATUSES))
        ) or 0,
        organizers_total=db.scalar(
            select(func.count()).select_from(User).where(User.role.in_((UserRole.organizer, UserRole.admin)))
        ) or 0,
        categories_total=db.scalar(select(func.count()).select_from(Category)) or 0,
    )
