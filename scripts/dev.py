"""Portable local commands. Invoke with the project's virtual-environment Python."""

import argparse
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def commands(task: str, name: str | None = None) -> list[tuple[Path, list[str]]]:
    interpreter = ROOT / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    python = str(interpreter) if interpreter.exists() else sys.executable
    npm = "npm.cmd" if os.name == "nt" else "npm"
    backend, frontend = ROOT / "backend", ROOT / "frontend"
    tasks = {
        "up": [(ROOT, ["docker", "compose", "up", "-d"])],
        "down": [(ROOT, ["docker", "compose", "down"])],
        "migrate": [(backend, [python, "-m", "alembic", "upgrade", "head"])],
        "test": [(backend, [python, "-m", "pytest", "-p", "no:cacheprovider"])],
        "backend-ci": [(ROOT, [python, "scripts/check_backend_ci.py"])],
        "backend-ci-tests": [(ROOT, [python, "scripts/check_backend_ci.py", "--tests"])],
        "lint": [
            (backend, [python, "-m", "ruff", "check", "."]),
            (backend, [python, "-m", "ruff", "format", "--check", "."]),
            (backend, [python, "-m", "mypy", "--strict", "app"]),
            (ROOT, [python, "-m", "ruff", "check", "scripts", "--line-length", "120"]),
            (
                ROOT,
                [
                    python,
                    "-m",
                    "ruff",
                    "format",
                    "--check",
                    "scripts",
                    "--line-length",
                    "120",
                ],
            ),
        ],
        "fe-test": [(frontend, [npm, "test"])],
        "fe-e2e": [(frontend, [npm, "run", "test:e2e"])],
        "fe-lint": [
            (frontend, [npm, "run", "lint"]),
            (frontend, [npm, "run", "typecheck"]),
        ],
        "fe-build": [(frontend, [npm, "run", "build"])],
        "fe-format-check": [(frontend, [npm, "run", "format:check"])],
        "traceability": [
            (
                ROOT,
                [
                    python,
                    "scripts/check_traceability.py",
                    "--complete-p00",
                    "--complete-p01",
                    "--complete-p02",
                    "--complete-p03",
                    "--complete-p04",
                    "--complete-p05",
                    "--complete-p06",
                    "--complete-p07",
                    "--complete-p08",
                    "--complete-p09",
                    "--complete-p10",
                    "--complete-p11",
                    "--complete-p12",
                ],
            )
        ],
        "seed": [(backend, [python, "-m", "app.seed"])],
        "hooks": [(ROOT, [python, "-X", "utf8", "-m", "pre_commit", "install"])],
        "api-types": [
            (ROOT, [python, "scripts/export_openapi.py"]),
            (frontend, [npm, "run", "api:types"]),
        ],
    }
    if task == "makemigration":
        if not name:
            raise ValueError("makemigration requires --name")
        return [
            (
                backend,
                [python, "-m", "alembic", "revision", "--autogenerate", "-m", name],
            )
        ]
    if task == "verify":
        return [
            command
            for part in (
                "lint",
                "backend-ci-tests",
                "fe-lint",
                "fe-format-check",
                "fe-test",
                "fe-build",
                "traceability",
            )
            for command in tasks[part]
        ]
    if task not in tasks:
        raise ValueError(f"Unknown command: {task}")
    return tasks[task]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("task")
    parser.add_argument("--name")
    args = parser.parse_args()
    try:
        selected = commands(args.task, args.name)
    except ValueError as exc:
        parser.error(str(exc))
    for cwd, command in selected:
        print(f"Running {args.task} in {cwd.name}", flush=True)
        result = subprocess.run(command, cwd=cwd, check=False)
        if result.returncode:
            raise SystemExit(result.returncode)
