import unittest

import tomllib
from check_backend_ci import ROOT, check_commands
from dev import commands


class BackendCITests(unittest.TestCase):
    def test_ci_critical_versions_match_runtime_and_development(self) -> None:
        manifest = tomllib.loads((ROOT / "backend/pyproject.toml").read_text())
        requirements = (ROOT / "backend/requirements.txt").read_text().splitlines()
        declared = manifest["project"]["dependencies"] + manifest["project"]["optional-dependencies"]["dev"]
        for package in ("sqlalchemy[asyncio]", "alembic", "ruff", "mypy"):
            matches = [line for line in requirements if line.startswith(package + "==")]
            self.assertEqual(len(matches), 1)
            self.assertIn(matches[0], declared)
            self.assertIn(
                matches[0].replace("[asyncio]", ""), (ROOT / "backend/constraints.txt").read_text().lower().splitlines()
            )

    def test_all_clean_install_paths_use_constraints(self) -> None:
        self.assertIn("-c constraints.txt", (ROOT / "backend/requirements.txt").read_text())
        self.assertIn("-c constraints.txt .", (ROOT / "backend/Dockerfile").read_text())
        self.assertIn("requirements.txt constraints.txt", (ROOT / "backend/Dockerfile.ci").read_text())
        self.assertIn("-c ../backend/constraints.txt ../backend", (ROOT / ".github/workflows/ci.yml").read_text())

    def test_gate_checks_typing_and_migration_drift(self) -> None:
        checks = check_commands(False)
        self.assertIn(["python", "-m", "mypy", "--strict", "--no-incremental", "app"], checks)
        self.assertIn(["python", "-m", "alembic", "upgrade", "head"], checks)
        self.assertIn(["python", "-m", "alembic", "check"], checks)
        self.assertFalse(any("pytest" in command for command in checks))

    def test_full_verification_uses_linux_tests(self) -> None:
        self.assertIn("pytest", check_commands(True)[-1])
        self.assertTrue(
            any("scripts/check_backend_ci.py" in command and "--tests" in command for _, command in commands("verify"))
        )

    def test_database_has_no_shared_volume_port_or_env_file(self) -> None:
        config = (ROOT / "docker-compose.ci.yml").read_text()
        for forbidden in ("ports:", "env_file:", "container_name:", "backend/.env", "5434", "5433"):
            self.assertNotIn(forbidden, config)
        self.assertIn("/var/lib/postgresql/data", config)
        self.assertIn("tezfarmo_ci", config)
