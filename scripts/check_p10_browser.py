"""P10 browser acceptance on disposable containers with independent ports and no external credentials."""

import os
import subprocess
from pathlib import Path
from uuid import uuid4

ROOT = Path(__file__).resolve().parent.parent


def main() -> None:
    project = f"tezfarmo-p10-{uuid4().hex[:10]}"
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
    ports: !override ["127.0.0.1:18110:8000"]
    environment:
      CORS_ORIGINS: http://127.0.0.1:15110
      FRONTEND_BASE_URL: http://127.0.0.1:15110
      TELEGRAM_BOT_TOKEN: ""
      TELEGRAM_BOT_USERNAME: ""
      TELEGRAM_WEBHOOK_PATH_TOKEN: ""
      TELEGRAM_WEBHOOK_SECRET: ""
  celery-worker:
    image: tezfarmo-backend-ci
    build: !reset null
    working_dir: /app
  celery-beat:
    image: tezfarmo-backend-ci
    build: !reset null
    working_dir: /app
  frontend:
    # Test the built snapshot; concurrent IDE edits must not hot-reload acceptance.
    volumes: !reset []
    ports: !override ["127.0.0.1:15110:5174"]
""",
        encoding="utf-8",
    )
    compose = ["docker", "compose", "-p", project, "-f", "docker-compose.p00.yml", "-f", str(override)]
    try:
        # backend-ci builds the clean Linux image first; this stack only builds its own frontend.
        subprocess.run(
            compose + ["up", "-d", "--build", "--wait", "--wait-timeout", "180", "backend", "frontend"],
            cwd=ROOT,
            check=True,
        )
        environment = os.environ | {
            "P00_BASE_URL": "http://127.0.0.1:15110",
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
                "returns.spec.ts",
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
