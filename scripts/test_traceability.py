import json
import tempfile
import unittest
from pathlib import Path

from check_traceability import check


class TraceabilityTests(unittest.TestCase):
    def test_valid_reference_and_missing_test(self) -> None:
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent) as directory:
            root = Path(directory)
            (root / "docs").mkdir()
            (root / "TZ.md").write_text("FND-004", encoding="utf-8")
            (root / "tests.py").write_text("async def test_transaction(): pass", encoding="utf-8")
            manifest = root / "docs/traceability.json"
            manifest.write_text(json.dumps({"FND-004": ["tests.py::test_transaction"]}), encoding="utf-8")
            self.assertEqual(check(root), [])
            (root / "tests.py").write_text("async def renamed(): pass", encoding="utf-8")
            self.assertIn("test function not found", check(root)[0])
            manifest.write_text(json.dumps({"FAKE-999": []}), encoding="utf-8")
            self.assertEqual(len(check(root)), 2)
            (root / "feature.test.ts").write_text("it('sends headers', () => {});", encoding="utf-8")
            manifest.write_text(json.dumps({"FND-004": ["feature.test.ts::sends headers"]}), encoding="utf-8")
            self.assertEqual(check(root), [])
            (root / "feature.test.ts").write_text("it('renamed', () => {});", encoding="utf-8")
            self.assertIn("test title not found", check(root)[0])
