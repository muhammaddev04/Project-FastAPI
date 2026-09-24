from fastapi.testclient import TestClient

from app.api.v1.routes.auth import USER_BY_ID
from app.main import app

client = TestClient(app)


def test_access_token_rejected_after_token_version_bump():
    phone = "+992777000222"
    start = client.post("/api/v1/auth/register/start", json={"phone": phone})
    code = start.json()["debug_code"]
    registration = client.post("/api/v1/auth/register/verify", json={"phone": phone, "code": code}).json()["registration_token"]
    response = client.post("/api/v1/auth/register/complete", json={"registration_token": registration, "full_name": "Version User", "password": "VersionPass456", "language": "en"})
    access = response.json()["access_token"]
    user_id = response.json()["user"]["id"]
    USER_BY_ID[user_id].token_version += 1

    me = client.get("/api/v1/me", headers={"Authorization": f"Bearer {access}"})
    assert me.status_code == 401
    assert me.json()["detail"]["code"] == "token_invalid"
