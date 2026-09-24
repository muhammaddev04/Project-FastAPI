from app.google_oauth import GoogleOAuthProvider


def test_google_auth_url_is_built():
    provider = GoogleOAuthProvider(client_id="demo-client", redirect_uri="http://localhost:5173/auth/google/callback")
    url = provider.build_auth_url("some-state")
    assert "https://accounts.google.com/o/oauth2/v2/auth" in url
    assert "client_id=demo-client" in url
    assert "state=some-state" in url


def test_google_exchange_requires_configuration():
    provider = GoogleOAuthProvider(client_id="", client_secret="", redirect_uri="")
    try:
        provider.exchange_code_for_user("code")
        assert False, "Expected ValueError"
    except ValueError as exc:
        assert str(exc) == "google_oauth_not_configured"
