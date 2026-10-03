import sys
import unittest

from dev import ROOT, commands


class DevCommandsTests(unittest.TestCase):
    def test_migration_name_is_one_argument(self) -> None:
        cwd, command = commands("makemigration", "add order items")[0]
        self.assertEqual(cwd, ROOT / "backend")
        self.assertEqual(command[0], sys.executable)
        self.assertEqual(command[-2:], ["-m", "add order items"])

    def test_invalid_command_and_missing_name(self) -> None:
        for task in ("unknown", "makemigration"):
            with self.assertRaises(ValueError):
                commands(task)

    def test_verify_has_no_production_migration_or_shutdown(self) -> None:
        selected = commands("verify")
        self.assertTrue(selected)
        self.assertFalse(any("docker" in command or "alembic" in command for _, command in selected))
