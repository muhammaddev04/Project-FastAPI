"""P12 browser acceptance on disposable containers with independent ports and no external credentials."""

import os
import subprocess
from pathlib import Path
from uuid import uuid4

ROOT = Path(__file__).resolve().parent.parent


def main() -> None:
    project = f"tezfarmo-p12-{uuid4().hex[:10]}"
    override = ROOT / f".env.{project}.yml"
    override.write_text(
        """services:
  postgres:
    ports: !reset []
  redis:
    ports: !reset []
  storage:
    ports: !reset []
  backend:
    image: tezfarmo-backend-ci
    build: !reset null
    working_dir: /app
    volumes:
      - ./backend/alembic.ini:/app/alembic.ini:ro
    ports: !override ["127.0.0.1:18121:8000"]
    environment:
      CORS_ORIGINS: http://127.0.0.1:15121
      FRONTEND_BASE_URL: http://127.0.0.1:15121
  celery-worker:
    image: tezfarmo-backend-ci
    build: !reset null
    working_dir: /app
    command: celery -A app.celery_app:celery_app worker --loglevel=WARNING --concurrency=2 -Q default,notifications,heavy
    healthcheck:
      timeout: 30s
  celery-beat:
    image: tezfarmo-backend-ci
    build: !reset null
    working_dir: /app
  frontend:
    # Test the built snapshot; concurrent IDE edits must not hot-reload acceptance.
    volumes: !reset []
    ports: !override ["127.0.0.1:15121:5174"]
""",
        encoding="utf-8",
    )
    compose = ["docker", "compose", "-p", project, "-f", "docker-compose.p00.yml", "-f", str(override)]
    try:
        # The export worker is part of the acceptance, so the Celery services come up with the stack.
        subprocess.run(
            compose
            + [
                "up",
                "-d",
                "--build",
                "--wait",
                "--wait-timeout",
                "240",
                "backend",
                "frontend",
                "celery-worker",
                "celery-beat",
            ],
            cwd=ROOT,
            check=True,
        )
        environment = os.environ | {
            "P00_BASE_URL": "http://127.0.0.1:15121",
            "P12_COMPOSE_PROJECT": project,
            "P12_COMPOSE_OVERRIDE": str(override),
            # The shared business fixture reads these names; the stack they point at is this one.
            "P10_COMPOSE_PROJECT": project,
            "P10_COMPOSE_OVERRIDE": str(override),
        }
        npm = "npm.cmd" if os.name == "nt" else "npm"
        subprocess.run(
            [
                npm,
                "run",
                "test:e2e",
                "--",
                "reports.spec.ts",
                "--output",
                str(ROOT / "frontend/test-results" / project),
            ],
            cwd=ROOT / "frontend",
            env=environment,
            check=True,
        )
    finally:
        subprocess.run(compose + ["down", "--volumes", "--remove-orphans"], cwd=ROOT, check=True)
        override.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
