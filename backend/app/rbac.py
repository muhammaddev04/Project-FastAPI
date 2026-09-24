from __future__ import annotations

from fastapi import Depends, HTTPException, status

from app.models import User, get_role_permissions

ROLE_PERMISSIONS: dict[str, list[str]] = {
    "OWNER": ["members.view", "members.invite", "members.change_role", "members.suspend", "members.revoke"],
    "MANAGER": ["members.view"],
    "OPERATOR": [],
    "WAREHOUSE": [],
    "COURIER": [],
    "SELLER": [],
}


def user_has_permission(user: User, permission: str) -> bool:
    granted = set()
    for role in user.roles:
        granted.update(get_role_permissions(role))
    return permission in granted


def require_permission(permission: str):
    def dependency(user: User = Depends(lambda: None)) -> User:
        if user is None or not user_has_permission(user, permission):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail={"code": "permission_denied", "message": f"Missing permission: {permission}"})
        return user

    return dependency
