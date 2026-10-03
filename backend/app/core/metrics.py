"""FND-021: bounded HTTP counters in Prometheus text format, per API process."""

import ipaddress
import json
import time
from collections import Counter

from fastapi import APIRouter, Request
from fastapi.responses import Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.errors import AppError

requests: Counter[tuple[str, str, int]] = Counter()
duration: Counter[tuple[str, str]] = Counter()
metrics_router = APIRouter()


class MetricsMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["path"] == "/metrics":
            await self.app(scope, receive, send)
            return
        status = 500
        started = time.perf_counter()

        async def observed_send(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
            await send(message)

        try:
            await self.app(scope, receive, observed_send)
        finally:
            # Templates exclude object IDs; unmatched URLs collapse into one label.
            route = getattr(scope.get("route"), "path", "unmatched")
            method = (
                scope["method"]
                if scope["method"] in {"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"}
                else "OTHER"
            )
            requests[method, route, status] += 1
            duration[method, route] += time.perf_counter() - started


@metrics_router.get("/metrics", include_in_schema=False)
async def metrics(request: Request) -> Response:
    try:
        address = ipaddress.ip_address(request.client.host if request.client else "")
    except ValueError:
        raise AppError("permission_denied", 403) from None
    allowed = address.is_loopback or any(
        address in ipaddress.ip_network(cidr)
        for cidr in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "fc00::/7")
        if address.version == ipaddress.ip_network(cidr).version
    )
    if not allowed:
        raise AppError("permission_denied", 403)
    lines = ["# TYPE tezfarmo_http_requests_total counter", "# TYPE tezfarmo_http_duration_seconds_total counter"]
    for (method, route, status), count in sorted(requests.items()):
        labels = f'method={json.dumps(method)},route={json.dumps(route)},status="{status}"'
        lines.append(f"tezfarmo_http_requests_total{{{labels}}} {count}")
    for (method, route), seconds in sorted(duration.items()):
        labels = f"method={json.dumps(method)},route={json.dumps(route)}"
        lines.append(f"tezfarmo_http_duration_seconds_total{{{labels}}} {seconds}")
    return Response("\n".join(lines) + "\n", media_type="text/plain; version=0.0.4")
