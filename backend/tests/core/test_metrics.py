from httpx import ASGITransport, AsyncClient

from app.main import app


async def test_fnd_021_metrics_internal_only() -> None:
    for host, expected in (("127.0.0.1", 200), ("10.1.2.3", 200), ("8.8.8.8", 403)):
        async with AsyncClient(transport=ASGITransport(app=app, client=(host, 1234)), base_url="http://test") as client:
            await client.get("/api/health/live")
            response = await client.get("/metrics", headers={"X-Forwarded-For": "127.0.0.1"})
            assert response.status_code == expected
            if expected == 200:
                assert 'route="/api/health/live"' in response.text
                assert "tezfarmo_http_requests_total" in response.text
