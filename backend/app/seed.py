"""Демо-данные. Создаются при первом запуске, если база пуста.

Демо-аккаунты (пароль у всех — campus123):
  student@campus.test    — студент
  organizer@campus.test  — организатор
  admin@campus.test      — администратор
"""
import random
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from .auth import hash_password
from .models import (
    Category,
    CheckIn,
    Event,
    EventStatus,
    EventTag,
    Faculty,
    Notification,
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
from .services import new_qr_token

DEMO_PASSWORD = "campus123"

FACULTIES = [
    ("Институт информационных технологий", "ИИТ"),
    ("Институт экономики и управления", "ИЭУ"),
    ("Институт физики и математики", "ИФМ"),
    ("Гуманитарный институт", "ГИ"),
    ("Институт физической культуры и спорта", "ИФКС"),
]

CATEGORIES = [
    ("Лекции", "lectures", "bi-mic", "#4f46e5"),
    ("Конференции", "conferences", "bi-people", "#0891b2"),
    ("Хакатоны", "hackathons", "bi-code-slash", "#16a34a"),
    ("Культура", "culture", "bi-music-note-beamed", "#db2777"),
    ("Спорт", "sport", "bi-trophy", "#ea580c"),
    ("Мастер-классы", "workshops", "bi-tools", "#7c3aed"),
]

VENUES = [
    ("Актовый зал", "Главный корпус", None, "ул. Университетская, 1", 400),
    ("Аудитория 305", "Корпус ИИТ", "305", "ул. Университетская, 3", 60),
    ("Коворкинг «Точка кипения»", "Библиотека", "2 этаж", "ул. Студенческая, 7", 120),
    ("Конференц-зал", "Корпус ИЭУ", "101", "пр. Науки, 12", 150),
    ("Стадион «Буревестник»", "Спорткомплекс", None, "ул. Спортивная, 5", 1000),
    ("Малый зал ДК", "Дом культуры", None, "ул. Студенческая, 9", 200),
]

FIRST_NAMES = ["Анна", "Иван", "Мария", "Дмитрий", "Екатерина", "Алексей", "София", "Никита", "Полина", "Артём",
               "Дарья", "Максим", "Алина", "Егор", "Ксения", "Кирилл", "Виктория", "Михаил", "Елизавета", "Глеб"]
LAST_NAMES = ["Смирнов", "Кузнецов", "Попов", "Васильев", "Петров", "Соколов", "Михайлов", "Новиков", "Фёдоров",
              "Морозов", "Волков", "Алексеев", "Лебедев", "Семёнов", "Егоров", "Павлов", "Козлов", "Степанов"]
FEMALE = {"Анна", "Мария", "Екатерина", "София", "Полина", "Дарья", "Алина", "Ксения", "Виктория", "Елизавета"}

REVIEW_TEXTS = [
    "Очень полезно, спасибо организаторам!",
    "Интересные спикеры, но не хватило времени на вопросы.",
    "Отличная атмосфера, приду ещё.",
    "Хорошо организовано, всё началось вовремя.",
    "Материал местами сложный, но в целом понравилось.",
    None,
]


def _at(base: datetime, days: int, hour: int, minute: int = 0) -> datetime:
    return (base + timedelta(days=days)).replace(hour=hour, minute=minute, second=0, microsecond=0)


def seed_if_empty(db: Session) -> None:
    if db.scalar(select(User.id).limit(1)) is not None:
        return
    seed(db)


def seed(db: Session) -> None:
    rnd = random.Random(42)
    today = datetime.now().replace(second=0, microsecond=0)
    pwd = hash_password(DEMO_PASSWORD)

    faculties = [Faculty(name=n, short_name=s) for n, s in FACULTIES]
    categories = {slug: Category(name=n, slug=slug, icon=i, color=c) for n, slug, i, c in CATEGORIES}
    venues = [Venue(name=n, building=b, room=r, address=a, capacity=c) for n, b, r, a, c in VENUES]
    db.add_all(faculties + list(categories.values()) + venues)

    student = User(email="student@campus.test", password_hash=pwd, full_name="Анна Смирнова",
                   role=UserRole.student, faculty=faculties[0], student_group="ИТ-21")
    organizer = User(email="organizer@campus.test", password_hash=pwd, full_name="Павел Орлов",
                     role=UserRole.organizer, faculty=faculties[0])
    organizer2 = User(email="culture@campus.test", password_hash=pwd, full_name="Ольга Белова",
                      role=UserRole.organizer, faculty=faculties[3])
    admin = User(email="admin@campus.test", password_hash=pwd, full_name="Администратор", role=UserRole.admin)
    db.add_all([student, organizer, organizer2, admin])

    students = []
    for i in range(40):
        first = rnd.choice(FIRST_NAMES)
        last = rnd.choice(LAST_NAMES) + ("а" if first in FEMALE else "")
        fac = rnd.choice(faculties)
        students.append(User(
            email=f"student{i + 1}@campus.test", password_hash=pwd, full_name=f"{first} {last}",
            role=UserRole.student, faculty=fac, student_group=f"{fac.short_name}-{rnd.randint(20, 24)}",
        ))
    db.add_all(students)

    tags: dict[str, Tag] = {}

    def tag(name: str) -> Tag:
        if name not in tags:
            tags[name] = Tag(name=name)
        return tags[name]

    # (название, кратко, описание, категория, площадка, организатор, институт, день, час, длит., лимит,
    #  теги, программа[(смещение мин, пункт, спикер)], занято мест, лист ожидания)
    specs = [
        ("Хакатон «Умный кампус»", "48 часов, чтобы сделать университет удобнее",
         "Командный хакатон по разработке сервисов для студентов и преподавателей. Формируйте команды до 5 человек, "
         "выбирайте трек (навигация, расписание, экология) и защищайте прототип перед жюри из индустрии. "
         "Питание и мерч — от организаторов.",
         "hackathons", 2, organizer, 0, 9, 10, 32, 60, ["it", "командная работа", "призы"],
         [(0, "Открытие и презентация треков", "Павел Орлов"), (60, "Формирование команд", None),
          (24 * 60, "Чекпоинт с менторами", None), (32 * 60 - 120, "Защита проектов", "Жюри")], 41, 0),
        ("Открытая лекция: нейросети в науке", "Как ИИ меняет физику, биологию и медицину",
         "Приглашённый исследователь расскажет, как модели машинного обучения помогают открывать новые материалы, "
         "расшифровывать структуру белков и ставить диагнозы. После лекции — сессия вопросов.",
         "lectures", 0, organizer, 2, 1, 18, 2, 400, ["ии", "наука", "открытая лекция"],
         [(0, "Лекция", "д.ф.-м.н. Игорь Савельев"), (75, "Вопросы из зала", None)], 156, 0),
        ("Мастер-класс по Git и GitHub", "Практика командной разработки за 3 часа",
         "Разберём ветки, pull request'ы, ревью кода и разрешение конфликтов на живом проекте. "
         "Нужен ноутбук с установленным Git.",
         "workshops", 1, organizer, 0, 0, 17, 3, 5, ["it", "git", "практика"],
         [(0, "Основы: коммиты и ветки", "Павел Орлов"), (60, "Pull request и ревью", "Павел Орлов"),
          (120, "Разрешение конфликтов", None)], 5, 3),
        ("Научная конференция «Шаг в науку»", "Студенческие доклады по 6 секциям",
         "Ежегодная конференция молодых исследователей. Секции: IT, экономика, физика, филология, педагогика, спорт. "
         "Лучшие доклады будут рекомендованы к публикации в сборнике.",
         "conferences", 3, organizer, None, 6, 10, 6, 150, ["наука", "доклады", "сертификат"],
         [(0, "Пленарное заседание", "Ректор"), (90, "Работа секций", None), (300, "Награждение", None)], 64, 0),
        ("Вечер студенческой песни", "Акустика, гитары и чай",
         "Камерный концерт студенческих коллективов и сольных исполнителей. Открытый микрофон после основной программы.",
         "culture", 5, organizer2, 3, 4, 19, 3, 200, ["музыка", "творчество"],
         [(0, "Выступления коллективов", None), (90, "Открытый микрофон", None)], 88, 0),
        ("Межфакультетский турнир по мини-футболу", "Сборные институтов, игра на выбывание",
         "Соревнования между сборными институтов. Болельщики приветствуются! Регистрация — для участников и зрителей.",
         "sport", 4, organizer2, 4, 8, 11, 6, 300, ["футбол", "турнир"],
         [(0, "Групповой этап", None), (180, "Плей-офф", None), (330, "Финал и награждение", None)], 120, 0),
        ("Карьерный день IT-компаний", "Стажировки, вакансии и экспресс-собеседования",
         "Представители 15 компаний расскажут о стажировках, проведут экспресс-собеседования и разберут резюме.",
         "conferences", 3, organizer, 1, 12, 12, 5, 150, ["карьера", "it", "стажировки"],
         [(0, "Презентации компаний", None), (120, "Экспресс-собеседования", None)], 97, 0),
        ("Лекция «Финансовая грамотность студента»", "Бюджет, вклады, налоговые вычеты",
         "Практическая лекция о том, как планировать бюджет, копить и не попасться на мошенников.",
         "lectures", 3, organizer, 1, 15, 16, 2, 150, ["финансы", "открытая лекция"],
         [(0, "Лекция", "Марина Котова"), (80, "Вопросы", None)], 34, 0),
        ("Фотопрогулка по историческому центру", "Учимся снимать архитектуру на телефон",
         "Прогулка с фотографом: композиция, свет, обработка. Сбор у главного входа.",
         "workshops", 0, organizer2, 3, 18, 12, 3, 25, ["фото", "творчество", "город"],
         [(0, "Теория за 15 минут", "Денис Гаврилов"), (20, "Прогулка и съёмка", None)], 9, 0),
        ("Олимпиада по программированию", "Индивидуальный зачёт, 5 часов, 10 задач",
         "Отборочный этап на чемпионат ICPC. Язык — любой из поддерживаемых системой.",
         "hackathons", 1, organizer, 0, 21, 10, 5, 60, ["it", "алгоритмы", "олимпиада"],
         [(0, "Пробный тур", None), (30, "Основной тур", None)], 22, 0),
        # Прошедшие мероприятия — для истории посещений и отзывов
        ("Лекция «Квантовые компьютеры простым языком»", "Кубиты, суперпозиция и реальные применения",
         "Популярная лекция о квантовых вычислениях без формул.",
         "lectures", 0, organizer, 2, -10, 18, 2, 400, ["наука", "физика", "открытая лекция"],
         [(0, "Лекция", "к.ф.-м.н. Елена Рябова")], 210, 0),
        ("Хакатон «Цифровая экономика»", "Решения для малого бизнеса",
         "Командный хакатон по созданию сервисов для предпринимателей.",
         "hackathons", 2, organizer, 1, -20, 10, 24, 60, ["it", "экономика", "призы"],
         [(0, "Старт", None), (23 * 60, "Защита", "Жюри")], 48, 0),
        ("Осенний бал", "Живая музыка и вальс",
         "Традиционный осенний бал университета. Дресс-код — вечерний.",
         "culture", 0, organizer2, 3, -15, 19, 4, 400, ["танцы", "музыка"],
         [(0, "Открытие", None), (30, "Вальс", None)], 260, 0),
    ]

    events: list[Event] = []
    for (title, short, desc, cat, venue_i, org, fac_i, day, hour, dur_h, cap, tag_names, program, taken, waiting) in specs:
        start = _at(today, day, hour)
        if day >= 0 and start - timedelta(hours=2) < today:  # регистрация должна быть ещё открыта
            start = (today + timedelta(hours=3)).replace(minute=0)
        end = start + timedelta(hours=dur_h)
        is_past = end < today
        ev = Event(
            title=title, short_description=short, description=desc, category=categories[cat],
            venue=venues[venue_i], organizer=org, faculty=faculties[fac_i] if fac_i is not None else None,
            start_at=start, end_at=end, registration_deadline=start - timedelta(hours=1), capacity=cap,
            status=EventStatus.finished if is_past else EventStatus.published,
            created_at=start - timedelta(days=30), updated_at=start - timedelta(days=30),
        )
        ev.tag_links = [EventTag(tag=tag(t)) for t in tag_names]
        ev.program = [ProgramItem(start_at=start + timedelta(minutes=m), title=t, speaker=s) for m, t, s in program]
        db.add(ev)
        events.append((ev, taken, waiting, is_past))

    db.flush()

    # Регистрации массовых участников
    for ev, taken, waiting, is_past in events:
        pool = students[:]
        rnd.shuffle(pool)
        # в демо-базе 40 студентов, поэтому число регистраций ограничено размером пула
        regs_count = min(taken, len(pool))
        for i, u in enumerate(pool[:regs_count]):
            reg = Registration(event=ev, user=u, qr_token=new_qr_token(),
                               created_at=ev.start_at - timedelta(days=rnd.randint(1, 14)))
            if is_past and rnd.random() < 0.8:
                reg.status = RegistrationStatus.attended
                reg.check_in = CheckIn(checked_by_id=ev.organizer.id, checked_at=ev.start_at + timedelta(minutes=rnd.randint(-15, 10)))
                if rnd.random() < 0.5:
                    db.add(Review(event=ev, user=u, rating=rnd.choices([3, 4, 5], [1, 3, 5])[0],
                                  comment=rnd.choice(REVIEW_TEXTS), created_at=ev.end_at + timedelta(hours=rnd.randint(1, 48))))
            else:
                reg.status = RegistrationStatus.registered
            db.add(reg)
        for pos, u in enumerate(pool[regs_count:regs_count + waiting], start=1):
            db.add(Registration(event=ev, user=u, qr_token=new_qr_token(), status=RegistrationStatus.waitlist,
                                waitlist_position=pos, created_at=ev.start_at - timedelta(days=1)))

    # Демо-студентка: история посещений и одна предстоящая запись
    by_title = {ev.title: ev for ev, *_ in events}
    past_ev = by_title["Лекция «Квантовые компьютеры простым языком»"]
    reg = Registration(event=past_ev, user=student, qr_token=new_qr_token(), status=RegistrationStatus.attended,
                       created_at=past_ev.start_at - timedelta(days=5))
    reg.check_in = CheckIn(checked_by_id=organizer.id, checked_at=past_ev.start_at - timedelta(minutes=5))
    db.add(reg)
    db.add(Review(event=past_ev, user=student, rating=5, comment="Наконец-то поняла, что такое кубит!",
                  created_at=past_ev.end_at + timedelta(hours=3)))

    past_ev2 = by_title["Осенний бал"]
    reg = Registration(event=past_ev2, user=student, qr_token=new_qr_token(), status=RegistrationStatus.attended,
                       created_at=past_ev2.start_at - timedelta(days=3))
    reg.check_in = CheckIn(checked_by_id=organizer2.id, checked_at=past_ev2.start_at + timedelta(minutes=10))
    db.add(reg)

    upcoming = by_title["Открытая лекция: нейросети в науке"]
    db.add(Registration(event=upcoming, user=student, qr_token=new_qr_token(), status=RegistrationStatus.registered,
                        created_at=today - timedelta(days=2)))
    db.add(Notification(user=student, event=upcoming, type=NotificationType.registration,
                        title="Регистрация подтверждена",
                        message=f"Вы записаны на «{upcoming.title}» ({upcoming.start_at:%d.%m.%Y %H:%M}).",
                        created_at=today - timedelta(days=2), is_read=True))

    db.commit()
