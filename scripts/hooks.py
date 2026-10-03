"""Run staged-file Ruff hooks using the project interpreter."""

import subprocess
import sys

from dev import ROOT, commands

if __name__ == "__main__":
    python = commands("lint")[0][1][0]
    task = sys.argv[1]
    command = [python, "-m", "ruff", task, "--config", "backend/pyproject.toml"]
    if task == "check":
        command.append("--fix")
    raise SystemExit(subprocess.run(command + sys.argv[2:], cwd=ROOT, check=False).returncode)
