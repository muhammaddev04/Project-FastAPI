from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_register_login_and_me_flow():
    start = client.post("/api/v1/auth/register/start", json={"phone": "+992123456789"})
    assert start.status_code == 202, start.text
    payload = start.json()
    assert "debug_code" in payload

    verify = client.post(
        "/api/v1/auth/register/verify",
        json={"phone": "+992123456789", "code": payload["debug_code"]},
    )
    assert verify.status_code == 200, verify.text
    registration_token = verify.json()["registration_token"]
    assert registration_token

    complete = client.post(
        "/api/v1/auth/register/complete",
        json={
            "registration_token": registration_token,
            "full_name": "Test User",
            "password": "UniqueStrongPass123",
            "language": "en",
        },
    )
    assert complete.status_code == 201, complete.text
    body = complete.json()
    assert body["user"]["phone"] == "+992123456789"
    assert "access_token" in body

    me = client.get(
        "/api/v1/me",
        headers={"Authorization": f"Bearer {body['access_token']}"},
    )
    assert me.status_code == 200, me.text
    assert me.json()["phone"] == "+992123456789"


def test_login_invalid_credentials_returns_standard_error():
    response = client.post(
        "/api/v1/auth/login",
        json={"phone": "+992000000000", "password": "wrong-password"},
    )
    assert response.status_code == 401, response.text
    assert response.json()["detail"]["code"] == "invalid_credentials"


def test_me_requires_auth():
    response = client.get("/api/v1/me")
    assert response.status_code == 401, response.text
