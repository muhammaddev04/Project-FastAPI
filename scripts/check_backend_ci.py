"""Run Linux backend CI checks in a disposable, independent Docker Compose project."""

import argparse
import subprocess
from pathlib import Path
from uuid import uuid4

ROOT = Path(__file__).resolve().parent.parent


def check_commands(tests: bool) -> list[list[str]]:
    commands = [
        ["python", "-m", "pip", "check"],
        ["python", "-m", "ruff", "check", "."],
        ["python", "-m", "ruff", "format", "--check", "."],
        ["python", "-m", "mypy", "--strict", "--no-incremental", "app"],
        ["python", "-m", "alembic", "upgrade", "head"],
        ["python", "-m", "alembic", "check"],
    ]
    if tests:
        commands.append(["python", "-m", "pytest", "-q", "-p", "no:cacheprovider"])
    return commands


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tests", action="store_true", help="Also run the complete backend test suite")
    args = parser.parse_args()
    compose = ["docker", "compose", "-f", "docker-compose.ci.yml", "-p", f"tezfarmo-ci-{uuid4().hex[:12]}"]

    def run(command: list[str]) -> None:
        subprocess.run(compose + command, cwd=ROOT, check=True)

    try:
        run(["build", "backend"])
        run(
            [
                "up",
                "-d",
                "--wait",
                "--wait-timeout",
                "120",
                *(["postgres", "redis", "storage"] if args.tests else ["postgres"]),
            ]
        )
        for command in check_commands(args.tests):
            print("Checking: " + " ".join(command), flush=True)
            run(["run", "--rm", "--no-deps", "backend", *command])
    finally:
        subprocess.run(compose + ["down", "--volumes", "--remove-orphans"], cwd=ROOT, check=True)


if __name__ == "__main__":
    main()
