from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_refresh_token_and_logout_flow():
    start = client.post("/api/v1/auth/register/start", json={"phone": "+992777000111"})
    code = start.json()["debug_code"]
    token = client.post("/api/v1/auth/register/verify", json={"phone": "+992777000111", "code": code}).json()["registration_token"]
    registered = client.post(
        "/api/v1/auth/register/complete",
        json={
            "registration_token": token,
            "full_name": "Session User",
            "password": "StrongPass456",
            "language": "ru",
        },
    )
    payload = registered.json()
    access = payload["access_token"]
    refresh = payload["refresh_token"]

    me = client.get("/api/v1/me", headers={"Authorization": f"Bearer {access}"})
    assert me.status_code == 200

    logout = client.post("/api/v1/auth/logout", headers={"Authorization": f"Bearer {access}"})
    assert logout.status_code == 200
    assert logout.json()["status"] == "ok"

    refreshed = client.post("/api/v1/auth/refresh", json={"refresh_token": refresh})
    assert refreshed.status_code == 401
    assert refreshed.json()["detail"]["code"] == "refresh_token_reused"
