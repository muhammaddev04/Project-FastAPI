import asyncio
from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, File, Form, Query, UploadFile
from pydantic import BaseModel, ConfigDict, StringConstraints
from sqlalchemy import select

from app.core.errors import AppError
from app.core.storage import get_storage, user_object_key
from app.modules.files.images import normalize_image, read_upload
from app.modules.files.schemas import SignedUrlOut
from app.modules.identity.deps import CurrentUser, SessionDep, SuperadminDep
from app.modules.support.models import SupportTicket

router = APIRouter(prefix="/api/v1", tags=["support"])
Subject = Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=160)]
Message = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=5000)]
ImageMessage = Annotated[str, StringConstraints(strip_whitespace=True, max_length=5000)]
Status = Literal["OPEN", "IN_PROGRESS", "RESOLVED"]


class TicketIn(BaseModel):
    kind: Literal["BUG", "FEEDBACK"]
    subject: Subject | None = None
    message: Message
    page_url: Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)] | None = None


class TicketOut(TicketIn):
    subject: str
    message: ImageMessage
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    user_id: UUID
    status: Status
    reply: str | None
    created_at: datetime
    updated_at: datetime | None
    has_image: bool
    image_count: int


class TicketUpdate(BaseModel):
    status: Status
    reply: Annotated[str, StringConstraints(strip_whitespace=True, max_length=5000)] | None = None


@router.post("/support", response_model=TicketOut, status_code=201)
async def create_ticket(payload: TicketIn, session: SessionDep, user: CurrentUser) -> SupportTicket:
    values = payload.model_dump()
    values["subject"] = payload.subject or payload.message[:160]
    ticket = SupportTicket(user_id=user.id, **values)
    session.add(ticket)
    await session.flush()
    return ticket


@router.post("/support/with-image", response_model=TicketOut, status_code=201)
async def create_ticket_with_image(
    session: SessionDep,
    user: CurrentUser,
    kind: Annotated[Literal["BUG", "FEEDBACK"], Form()],
    image: Annotated[list[UploadFile], File()],
    message: Annotated[ImageMessage, Form()] = "",
) -> SupportTicket:
    storage = get_storage()
    keys: list[str] = []
    try:
        for upload in image:
            content_type, data = await read_upload(upload)
            normalized = await asyncio.to_thread(normalize_image, content_type, data, output_side=2560)
            key = user_object_key(user.id, "SUPPORT", normalized.extension)
            keys.append(key)
            await storage.put_private(key, normalized.data, normalized.content_type)
        ticket = SupportTicket(
            user_id=user.id,
            kind=kind,
            subject=message[:160] or "Screenshot",
            message=message,
            image_key=keys[0],
            additional_image_keys=keys[1:],
        )
        session.add(ticket)
        await session.flush()
        await session.commit()
    except BaseException:
        await session.rollback()
        await asyncio.gather(*(storage.delete(key) for key in keys), return_exceptions=True)
        raise
    return ticket


@router.get("/support/{ticket_id}/image", response_model=SignedUrlOut)
async def ticket_image(
    ticket_id: UUID,
    session: SessionDep,
    user: CurrentUser,
    index: Annotated[int, Query(ge=0)] = 0,
) -> SignedUrlOut:
    ticket = await session.get(SupportTicket, ticket_id)
    if ticket is None or (ticket.user_id != user.id and not user.is_superadmin) or index >= ticket.image_count:
        raise AppError("not_found", 404)
    signed = await get_storage().signed_url(ticket.image_keys[index])
    return SignedUrlOut(url=signed.url, expires_at=signed.expires_at)


@router.get("/support", response_model=list[TicketOut])
async def my_tickets(
    session: SessionDep,
    user: CurrentUser,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> list[SupportTicket]:
    rows = await session.scalars(
        select(SupportTicket)
        .where(SupportTicket.user_id == user.id)
        .order_by(SupportTicket.created_at.desc(), SupportTicket.id.desc())
        .offset(offset)
        .limit(limit)
    )
    return list(rows)


@router.get("/admin/support", response_model=list[TicketOut])
async def all_tickets(
    session: SessionDep,
    _admin: SuperadminDep,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> list[SupportTicket]:
    rows = await session.scalars(
        select(SupportTicket)
        .order_by(SupportTicket.created_at.desc(), SupportTicket.id.desc())
        .offset(offset)
        .limit(limit)
    )
    return list(rows)


@router.patch("/admin/support/{ticket_id}", response_model=TicketOut)
async def update_ticket(
    ticket_id: UUID,
    payload: TicketUpdate,
    session: SessionDep,
    _admin: SuperadminDep,
) -> SupportTicket:
    ticket = await session.get(SupportTicket, ticket_id, with_for_update=True)
    if ticket is None:
        raise AppError("not_found", 404)
    ticket.status = payload.status
    if "reply" in payload.model_fields_set:
        ticket.reply = payload.reply or None
    await session.flush()
    return ticket
