"""P11 browser acceptance on disposable containers with independent ports and no external credentials."""

import argparse
import os
import subprocess
from pathlib import Path
from uuid import uuid4

ROOT = Path(__file__).resolve().parent.parent


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--configured-telegram", action="store_true", help="Use isolated fake bot credentials for linking acceptance"
    )
    args = parser.parse_args()
    project = f"tezfarmo-p11-{uuid4().hex[:10]}"
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
    ports: !override ["127.0.0.1:18111:8000"]
    environment:
      CORS_ORIGINS: http://127.0.0.1:15111
      FRONTEND_BASE_URL: http://127.0.0.1:15111
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
    ports: !override ["127.0.0.1:15111:5174"]
""",
        encoding="utf-8",
    )
    if args.configured_telegram:
        override.write_text(
            override.read_text(encoding="utf-8")
            .replace('TELEGRAM_BOT_TOKEN: ""', 'TELEGRAM_BOT_TOKEN: "123456:isolated-test-token"')
            .replace('TELEGRAM_BOT_USERNAME: ""', 'TELEGRAM_BOT_USERNAME: "isolated_test_bot"')
            .replace('TELEGRAM_WEBHOOK_PATH_TOKEN: ""', 'TELEGRAM_WEBHOOK_PATH_TOKEN: "isolated-test-path"')
            .replace('TELEGRAM_WEBHOOK_SECRET: ""', 'TELEGRAM_WEBHOOK_SECRET: "isolated-test-secret"'),
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
            "P00_BASE_URL": "http://127.0.0.1:15111",
            "P11_COMPOSE_PROJECT": project,
            "P11_COMPOSE_OVERRIDE": str(override),
            "P11_TELEGRAM_CONFIGURED": "1" if args.configured_telegram else "0",
        }
        npm = "npm.cmd" if os.name == "nt" else "npm"
        subprocess.run(
            [npm, "run", "test:e2e", "--", "notifications.spec.ts"], cwd=ROOT / "frontend", env=environment, check=True
        )
    finally:
        subprocess.run(compose + ["down", "--volumes", "--remove-orphans"], cwd=ROOT, check=True)
        override.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
