from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import Field
from sqlalchemy import select

from app.core.errors import AppError
from app.core.filtering import ListQuery
from app.core.idempotency import IdempotentRoute, idempotent
from app.core.pagination import Page
from app.core.time import utcnow
from app.modules.catalog.models import PriceList
from app.modules.identity.deps import OrgContext, SessionDep, require_permission
from app.modules.organizations.models import Company, Store
from app.modules.partnerships import service
from app.modules.partnerships.models import Partnership, PartnershipTerms
from app.modules.partnerships.schemas import (
    AcceptIn,
    DeclineIn,
    InviteIn,
    LookupOut,
    PartnerProfile,
    PartnershipOut,
    PatchIn,
    ReasonIn,
    RequestIn,
    Status,
    TermsIn,
    TermsOut,
)

router = APIRouter(prefix="/api/v1/partnerships", tags=["partnerships"], route_class=IdempotentRoute)
Viewer = Annotated[OrgContext, Depends(require_permission("partners.view"))]
Manager = Annotated[OrgContext, Depends(require_permission("partners.manage"))]
Terminator = Annotated[OrgContext, Depends(require_permission("partners.terminate"))]
TermsManager = Annotated[OrgContext, Depends(require_permission("terms.manage"))]
TermsViewer = Annotated[OrgContext, Depends(require_permission("terms.view"))]


class PartnerQuery(ListQuery):
    status: Status | None = None
    initiated_by_side: Literal["COMPANY", "STORE"] | None = None
    search: str | None = Field(default=None, max_length=100)
    ordering: Literal["created_at", "-created_at"] = "-created_at"
    filter_columns = {"status": Partnership.status, "initiated_by_side": Partnership.initiated_by_side}
    search_columns = (Partnership.customer_code,)
    ordering_columns = {"created_at": Partnership.created_at}


async def terms_output(session: SessionDep, terms: PartnershipTerms) -> TermsOut:
    result = TermsOut.model_validate(terms)
    result.price_list_name = await session.scalar(select(PriceList.name).where(PriceList.id == terms.price_list_id))
    return result


async def output(session: SessionDep, context: OrgContext, partner: Partnership) -> PartnershipOut:
    result = PartnershipOut.model_validate(partner)
    company_side = context.organization.type == "COMPANY"
    profile = (
        await session.get(Store, partner.store_id) if company_side else await session.get(Company, partner.company_id)
    )
    if profile is None:
        raise AppError("not_found", 404)
    result.partner = PartnerProfile(
        id=profile.id,
        name=profile.legal_name,
        phone=profile.phone,
        city=profile.city,
        address=profile.address,
        verification_status=profile.verification_status,
    )
    if isinstance(profile, Store):
        result.partner.legal_name = profile.legal_name
        result.partner.logo_file_id = profile.logo_file_id
        result.partner.verified_at = profile.verified_at
        result.partner.updated_at = profile.updated_at
        result.partner.version = profile.version
        result.partner.email = profile.email
        result.partner.tax_identifier = profile.tax_identifier if profile.verification_status == "APPROVED" else None
        result.partner.latitude = profile.latitude
        result.partner.longitude = profile.longitude
    now = utcnow()
    history = await service.terms_service.history(session, partner.id)
    current = [terms for terms in history if terms.effective_from <= now]
    result.current_terms = await terms_output(session, current[-1]) if current else None
    result.future_terms = [await terms_output(session, terms) for terms in history if terms.effective_from > now]
    return result


@router.get("", response_model=Page[PartnershipOut])
async def listing(
    session: SessionDep, context: Viewer, query: Annotated[PartnerQuery, Query()]
) -> Page[PartnershipOut]:
    company_side = context.organization.type == "COMPANY"
    column = Partnership.company_id if company_side else Partnership.store_id
    model = Store if company_side else Company
    other_column = Partnership.store_id if company_side else Partnership.company_id
    statement = select(Partnership).join(model, model.id == other_column).where(column == context.organization.id)
    if query.search and query.search.strip():
        pattern = "%" + query.search.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        statement = statement.where(
            model.legal_name.ilike(pattern, escape="\\") | Partnership.customer_code.ilike(pattern, escape="\\")
        )
    # The other profile table depends on the authenticated side; its search is applied above.
    count, rows = await query.model_copy(update={"search": None}).fetch(session, statement, tie_breaker=Partnership.id)
    return Page[PartnershipOut].of(query.page, count, [await output(session, context, row[0]) for row in rows])


@router.get("/store-lookup", response_model=list[LookupOut])
async def lookup(
    session: SessionDep,
    context: Manager,
    phone: str | None = Query(default=None, max_length=16),
    tax_identifier: str | None = Query(default=None, max_length=32),
) -> list[LookupOut]:
    service.require(context, "partners.manage", "COMPANY")
    if bool(phone) == bool(tax_identifier):
        raise AppError("validation_error", 422, {"reason": "exactly_one_lookup_key"})
    stores = await session.scalars(
        select(Store)
        .where(Store.phone == phone if phone else Store.tax_identifier == tax_identifier)
        .order_by(Store.id)
    )
    return [LookupOut(id=store.id, name=store.legal_name, city=store.city) for store in stores]


@router.post(
    "/invite", response_model=PartnershipOut, status_code=201, dependencies=[idempotent(permission="partners.manage")]
)
async def invite(session: SessionDep, context: Manager, payload: InviteIn) -> PartnershipOut:
    return await output(session, context, await service.invite(session, context, payload))


@router.post(
    "/request", response_model=PartnershipOut, status_code=201, dependencies=[idempotent(permission="partners.manage")]
)
async def request(session: SessionDep, context: Manager, payload: RequestIn) -> PartnershipOut:
    return await output(session, context, await service.request(session, context, payload.company_public_code))


@router.get("/{partnership_id}", response_model=PartnershipOut)
async def detail(session: SessionDep, context: Viewer, partnership_id: UUID) -> PartnershipOut:
    return await output(session, context, await service.get(session, context, partnership_id))


@router.patch("/{partnership_id}", response_model=PartnershipOut)
async def patch(session: SessionDep, context: Manager, partnership_id: UUID, payload: PatchIn) -> PartnershipOut:
    return await output(session, context, await service.patch(session, context, partnership_id, payload))


@router.post(
    "/{partnership_id}/accept", response_model=PartnershipOut, dependencies=[idempotent(permission="partners.manage")]
)
async def accept(session: SessionDep, context: Manager, partnership_id: UUID, payload: AcceptIn) -> PartnershipOut:
    return await output(
        session, context, await service.transition(session, context, partnership_id, "accept", terms=payload.terms)
    )


@router.post("/{partnership_id}/decline", response_model=PartnershipOut)
async def decline(session: SessionDep, context: Manager, partnership_id: UUID, payload: DeclineIn) -> PartnershipOut:
    return await output(
        session, context, await service.transition(session, context, partnership_id, "decline", reason=payload.reason)
    )


@router.post("/{partnership_id}/cancel", response_model=PartnershipOut)
async def cancel(session: SessionDep, context: Manager, partnership_id: UUID) -> PartnershipOut:
    return await output(session, context, await service.transition(session, context, partnership_id, "cancel"))


@router.post("/{partnership_id}/suspend", response_model=PartnershipOut)
async def suspend(session: SessionDep, context: Manager, partnership_id: UUID, payload: ReasonIn) -> PartnershipOut:
    return await output(
        session, context, await service.transition(session, context, partnership_id, "suspend", payload.reason)
    )


@router.post("/{partnership_id}/reactivate", response_model=PartnershipOut)
async def reactivate(session: SessionDep, context: Manager, partnership_id: UUID) -> PartnershipOut:
    return await output(session, context, await service.transition(session, context, partnership_id, "reactivate"))


@router.post("/{partnership_id}/terminate", response_model=PartnershipOut)
async def terminate(
    session: SessionDep, context: Terminator, partnership_id: UUID, payload: ReasonIn
) -> PartnershipOut:
    return await output(
        session, context, await service.transition(session, context, partnership_id, "terminate", payload.reason)
    )


@router.get("/{partnership_id}/terms", response_model=list[TermsOut])
async def terms(session: SessionDep, context: TermsViewer, partnership_id: UUID) -> list[TermsOut]:
    partner = await service.get(session, context, partnership_id)
    return [await terms_output(session, item) for item in await service.terms_service.history(session, partner.id)]


@router.post(
    "/{partnership_id}/terms",
    response_model=TermsOut,
    status_code=201,
    dependencies=[idempotent(permission="terms.manage")],
)
async def append_terms(session: SessionDep, context: TermsManager, partnership_id: UUID, payload: TermsIn) -> TermsOut:
    return await terms_output(session, await service.append_terms(session, context, partnership_id, payload))
