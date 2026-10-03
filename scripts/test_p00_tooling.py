import json
import unittest

from dev import ROOT
from sync_error_catalog import check


class FoundationToolingTests(unittest.TestCase):
    def test_foundation_hooks_and_git_hygiene(self) -> None:
        hooks = (ROOT / ".pre-commit-config.yaml").read_text()
        for gate in (
            "detect-private-key",
            "check-added-large-files",
            "mypy",
            "ruff",
            "prettier",
            "eslint",
        ):
            self.assertIn(gate, hooks)
        self.assertIn("charset = utf-8", (ROOT / ".editorconfig").read_text())
        ignored = (ROOT / ".gitignore").read_text()
        for sensitive in (".env", ".venv/", "node_modules/"):
            self.assertIn(sensitive, ignored)

    def test_frontend_tooling_contract(self) -> None:
        scripts = json.loads((ROOT / "frontend/package.json").read_text())["scripts"]
        for gate in ("eslint", "prettier", "tsc", "openapi-typescript"):
            self.assertIn(gate, " ".join(scripts.values()))
        self.assertTrue(json.loads((ROOT / "frontend/tsconfig.app.json").read_text())["compilerOptions"]["strict"])

    def test_error_catalog_covers_every_language(self) -> None:
        self.assertEqual(check(), [])

    def test_ci_enforces_foundation_gates(self) -> None:
        workflow = (ROOT / ".github/workflows/ci.yml").read_text()
        for gate in (
            "mypy --strict",
            "alembic check",
            "pytest",
            "format:check",
            "typecheck",
            "npm test",
            "--complete-p00",
            "test:e2e",
        ):
            self.assertIn(gate, workflow)
