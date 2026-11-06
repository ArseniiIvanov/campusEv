from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import schemas
from ..auth import create_access_token, get_current_user, hash_password, verify_password
from ..database import get_db
from ..models import Faculty, User, UserRole

router = APIRouter(prefix="/api/auth", tags=["Авторизация"])


@router.post(
    "/register",
    response_model=schemas.TokenResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Регистрация студента",
)
def register(data: schemas.RegisterRequest, db: Session = Depends(get_db)):
    email = data.email.lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "Пользователь с таким email уже существует")
    if data.faculty_id is not None and db.get(Faculty, data.faculty_id) is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Институт не найден")
    user = User(
        email=email,
        password_hash=hash_password(data.password),
        full_name=data.full_name.strip(),
        faculty_id=data.faculty_id,
        student_group=data.student_group,
        role=UserRole.student,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return schemas.TokenResponse(access_token=create_access_token(user), user=user)


@router.post("/login", response_model=schemas.TokenResponse, summary="Вход по email и паролю")
def login(data: schemas.LoginRequest, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == data.email.lower()))
    if user is None or not verify_password(data.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Неверный email или пароль")
    return schemas.TokenResponse(access_token=create_access_token(user), user=user)


@router.get("/me", response_model=schemas.UserOut, summary="Текущий пользователь")
def me(user: User = Depends(get_current_user)):
    return user
