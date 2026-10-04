"""Trusted operator commands. Superadmin privileges are never granted through the API."""

import argparse
import asyncio
from getpass import getpass

from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import audit
from app.core.db import get_engine, get_sessionmaker
from app.core.security import hash_password
from app.core.time import utcnow
from app.modules.auth.password_policy import password_problems
from app.modules.identity.models import User


class AdminInput(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=2, max_length=150)


async def create_superadmin(session: AsyncSession, email: str, full_name: str, password: str) -> User:
    payload = AdminInput(email=email, full_name=full_name)
    if password_problems(password):
        raise ValueError("Password does not meet the password policy")
    if (await session.scalars(select(User.id).where(func.lower(User.email) == str(payload.email).lower()))).first():
        raise ValueError("Account already exists; this command only creates new administrators")
    user = User(
        email=str(payload.email).lower(),
        full_name=payload.full_name,
        password_hash=hash_password(password),
        email_verified_at=utcnow(),
        is_superadmin=True,
    )
    session.add(user)
    await session.flush()
    await audit.record(session, "user.superadmin_created", "user", user.id, new={"is_superadmin": True})
    return user


async def run(email: str, full_name: str, password: str) -> None:
    try:
        async with get_sessionmaker()() as session, session.begin():
            await create_superadmin(session, email, full_name, password)
        print("Superadmin created")
    finally:
        await get_engine().dispose()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["create-superadmin"])
    parser.add_argument("--email", required=True)
    parser.add_argument("--full-name", required=True)
    args = parser.parse_args()
    password = getpass("Password: ")
    if password != getpass("Confirm password: "):
        parser.error("Passwords do not match")
    asyncio.run(run(args.email, args.full_name, password))


if __name__ == "__main__":
    main()
