from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_login_rate_limit_blocks_repeated_failures():
    phone = "+992555111222"
    for _ in range(6):
        response = client.post("/api/v1/auth/login", json={"phone": phone, "password": "bad-password"})
    assert response.status_code == 429
    assert response.json()["detail"]["code"] == "rate_limit_exceeded"
