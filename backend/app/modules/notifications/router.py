from uuid import UUID

from fastapi import APIRouter, Response
from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert

from app.core.errors import AppError
from app.core.pagination import Page, PageParamsDep
from app.core.time import utcnow
from app.modules.identity.deps import CurrentUser, SessionDep
from app.modules.notifications.models import Notification, NotificationPreference
from app.modules.notifications.policy import GROUPS, POLICIES
from app.modules.notifications.schemas import NotificationOut, PreferenceIn, PreferenceOut, UnreadCount

router = APIRouter(prefix="/api/v1/notifications", tags=["notifications"])


@router.get("", response_model=Page[NotificationOut])
async def listing(
    session: SessionDep, user: CurrentUser, page: PageParamsDep, unread: bool = False
) -> Page[NotificationOut]:
    conditions = [Notification.user_id == user.id]
    if unread:
        conditions.append(Notification.read_at.is_(None))
    total = await session.scalar(select(func.count()).select_from(Notification).where(*conditions)) or 0
    rows = await session.scalars(
        select(Notification)
        .where(*conditions)
        .order_by(Notification.created_at.desc(), Notification.id.desc())
        .offset(page.offset)
        .limit(page.limit)
    )
    return Page[NotificationOut].of(page, total, [NotificationOut.model_validate(row) for row in rows])


@router.get("/unread-count", response_model=UnreadCount)
async def unread_count(session: SessionDep, user: CurrentUser) -> UnreadCount:
    count = await session.scalar(
        select(func.count())
        .select_from(Notification)
        .where(Notification.user_id == user.id, Notification.read_at.is_(None))
    )
    return UnreadCount(count=count or 0)


@router.post("/read-all", status_code=204)
async def read_all(session: SessionDep, user: CurrentUser) -> Response:
    await session.execute(
        update(Notification)
        .where(Notification.user_id == user.id, Notification.read_at.is_(None))
        .values(read_at=utcnow())
    )
    return Response(status_code=204)


@router.get("/preferences", response_model=list[PreferenceOut])
async def preferences(session: SessionDep, user: CurrentUser) -> list[PreferenceOut]:
    rows = await session.scalars(select(NotificationPreference).where(NotificationPreference.user_id == user.id))
    saved = {row.event_group: row.enabled for row in rows if row.channel == "TELEGRAM"}
    result = []
    for group in GROUPS:
        result.append(PreferenceOut(event_group=group, channel="IN_APP", enabled=True, locked=True))
        default = any(policy.telegram for policy in POLICIES.values() if policy.group == group)
        result.append(
            PreferenceOut(event_group=group, channel="TELEGRAM", enabled=saved.get(group, default), locked=False)
        )
    return result


@router.put("/preferences", response_model=list[PreferenceOut])
async def save_preferences(payload: list[PreferenceIn], session: SessionDep, user: CurrentUser) -> list[PreferenceOut]:
    if len(payload) > len(GROUPS) or len({row.event_group for row in payload}) != len(payload):
        raise AppError("validation_error", 422)
    for row in payload:
        await session.execute(
            insert(NotificationPreference)
            .values(user_id=user.id, **row.model_dump())
            .on_conflict_do_update(index_elements=["user_id", "event_group", "channel"], set_={"enabled": row.enabled})
        )
    return await preferences(session, user)


@router.post("/{notification_id}/read", response_model=NotificationOut)
async def mark_read(notification_id: UUID, session: SessionDep, user: CurrentUser) -> NotificationOut:
    row = await session.scalar(
        select(Notification)
        .where(Notification.id == notification_id, Notification.user_id == user.id)
        .with_for_update()
    )
    if row is None:
        raise AppError("not_found", 404)
    row.read_at = row.read_at or utcnow()
    await session.flush()
    return NotificationOut.model_validate(row)
