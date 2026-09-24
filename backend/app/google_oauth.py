from __future__ import annotations

from urllib.parse import urlencode

import httpx

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
        try:
            with httpx.Client(timeout=8.0) as client:
                token_response = client.post(
                    "https://oauth2.googleapis.com/token",
                    data={
                        "code": code,
                        "client_id": self.client_id,
                        "client_secret": self.client_secret,
                        "redirect_uri": self.redirect_uri,
                        "grant_type": "authorization_code",
                    },
                )
                token_response.raise_for_status()
                access_token = token_response.json().get("access_token")
                if not access_token:
                    raise ValueError("google_exchange_failed")
                profile_response = client.get(
                    "https://www.googleapis.com/oauth2/v3/userinfo",
                    headers={"Authorization": f"Bearer {access_token}"},
                )
                profile_response.raise_for_status()
                profile = profile_response.json()
        except (httpx.HTTPError, ValueError) as exc:
            if isinstance(exc, ValueError) and str(exc) in {"google_exchange_failed", "google_code_missing", "google_oauth_not_configured"}:
                raise
            raise ValueError("google_exchange_failed") from exc
        if not profile.get("sub") or not profile.get("email"):
            raise ValueError("google_profile_invalid")
        return {
            "provider": "google",
            "email": str(profile["email"]),
            "name": str(profile.get("name") or profile["email"]),
            "sub": str(profile["sub"]),
        }
