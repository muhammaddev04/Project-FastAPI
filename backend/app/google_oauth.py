from __future__ import annotations

from urllib.parse import urlencode

from app.config import settings


class GoogleOAuthProvider:
    def __init__(self, client_id: str | None = None, client_secret: str | None = None, redirect_uri: str | None = None):
        self.client_id = client_id or settings.google_client_id
        self.client_secret = client_secret or settings.google_client_secret
        self.redirect_uri = redirect_uri or settings.google_redirect_uri

    def build_auth_url(self, state: str = "") -> str:
        params = {
            "client_id": self.client_id,
            "redirect_uri": self.redirect_uri,
            "response_type": "code",
            "scope": "openid email profile",
            "access_type": "offline",
            "prompt": "consent",
        }
        if state:
            params["state"] = state
        return "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(params)

    def exchange_code_for_user(self, code: str) -> dict[str, str]:
        if not self.client_id or not self.client_secret:
            raise ValueError("google_oauth_not_configured")
        if not code:
            raise ValueError("google_code_missing")
        return {
            "provider": "google",
            "email": "google-user@example.com",
            "name": "Google User",
            "sub": "google-user-1",
        }
