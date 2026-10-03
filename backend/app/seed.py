"""Idempotent development-only accounts for exercising the four application areas."""

import asyncio

from sqlalchemy import select

from app.core.config import get_settings
from app.core.db import get_engine, get_sessionmaker
from app.core.security import hash_password
from app.core.storage import get_storage
from app.core.time import utcnow
from app.modules.identity.models import Membership, User
from app.modules.organizations.schemas import CompanyCreate, StoreCreate
from app.modules.organizations.service import create_organization

DEMO_PASSWORD = "P00Demo2026!"


async def seed() -> None:
    if get_settings().app_env != "development":
        raise RuntimeError("seed is allowed only in development")
    async with get_sessionmaker()() as session, session.begin():
        users: dict[str, User] = {}
        for name in ("company", "store", "courier", "admin"):
            email = f"p00-{name}@example.tj"
            user = (await session.scalars(select(User).where(User.email == email))).first()
            if user is None:
                user = User(
                    email=email,
                    full_name=f"P00 Demo {name.title()}",
                    language="en",
                    password_hash=hash_password(DEMO_PASSWORD),
                    email_verified_at=utcnow(),
                    is_superadmin=name == "admin",
                )
                session.add(user)
                await session.flush()
            users[name] = user
        orgs = {}
        for name in ("company", "store"):
            membership = (
                await session.scalars(
                    select(Membership).where(
                        Membership.user_id == users[name].id,
                        Membership.role == "OWNER",
                        Membership.status == "ACTIVE",
                    )
                )
            ).first()
            if membership is None:
                fields = dict(
                    name=f"P00 Demo {name.title()}",
                    legal_name=f"P00 Demo {name.title()} LLC",
                    phone="+992900000001",
                    city="Dushanbe",
                    address="Development demo address",
                )
                payload = (
                    CompanyCreate.model_validate({**fields, "tax_identifier": "990000001"})
                    if name == "company"
                    else StoreCreate.model_validate(fields)
                )
                created = await create_organization(session, users[name], name.upper(), payload)
                orgs[name] = created.organization.id
            else:
                orgs[name] = membership.organization_id
        courier = (
            await session.scalars(
                select(Membership).where(
                    Membership.user_id == users["courier"].id,
                    Membership.organization_id == orgs["company"],
                )
            )
        ).first()
        if courier is None:
            session.add(
                Membership(
                    user_id=users["courier"].id, organization_id=orgs["company"], role="COURIER", joined_at=utcnow()
                )
            )
    await get_storage()._ensure_bucket()


async def main() -> None:
    try:
        await seed()
        print("Development demo accounts ready: p00-{company,store,courier,admin}@example.tj")
    finally:
        await get_engine().dispose()


if __name__ == "__main__":
    asyncio.run(main())
