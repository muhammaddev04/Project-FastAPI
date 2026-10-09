import json
import tempfile
import unittest
from pathlib import Path

from check_traceability import check


class TraceabilityTests(unittest.TestCase):
    def test_complete_p10_requires_workflow_coverage_and_defers_p12_admin_view(self) -> None:
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent) as directory:
            root = Path(directory)
            (root / "docs").mkdir()
            (root / "TZ.md").write_text(
                "## [P10_returns_disputes]\nRET-001 DSP-023 DSP-024\n## [P11_notifications_telegram]",
                encoding="utf-8",
            )
            (root / "docs/traceability.json").write_text("{}", encoding="utf-8")
            self.assertEqual(
                check(root, complete_p10=True),
                ["Unmapped P10 requirement: DSP-024", "Unmapped P10 requirement: RET-001"],
            )

    def test_complete_p09_rejects_unmapped_requirement(self) -> None:
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent) as directory:
            root = Path(directory)
            (root / "docs").mkdir()
            (root / "TZ.md").write_text(
                "## [P09_finance]\nFIN-002 FIN-060\n## [P10_returns_disputes]", encoding="utf-8"
            )
            (root / "docs/traceability.json").write_text("{}", encoding="utf-8")
            self.assertEqual(
                check(root, complete_p09=True),
                ["Unmapped P09 requirement: FIN-002", "Unmapped P09 requirement: FIN-060"],
            )

    def test_complete_p06_rejects_unmapped_requirement(self) -> None:
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent) as directory:
            root = Path(directory)
            (root / "docs").mkdir()
            (root / "TZ.md").write_text("## [P06_partnerships]\nPRT-002 PRT-012\n## [P07_orders]", encoding="utf-8")
            (root / "docs/traceability.json").write_text("{}", encoding="utf-8")
            self.assertEqual(
                check(root, complete_p06=True),
                ["Unmapped P06 requirement: PRT-002", "Unmapped P06 requirement: PRT-012"],
            )

    def test_complete_p05_rejects_unmapped_requirement(self) -> None:
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent) as directory:
            root = Path(directory)
            (root / "docs").mkdir()
            (root / "TZ.md").write_text("## [P05_inventory]\nINV-001 INV-010\n## [P06_partnerships]", encoding="utf-8")
            (root / "docs/traceability.json").write_text("{}", encoding="utf-8")
            self.assertEqual(
                check(root, complete_p05=True),
                ["Unmapped P05 requirement: INV-001", "Unmapped P05 requirement: INV-010"],
            )

    def test_complete_p03_rejects_unmapped_requirement(self) -> None:
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent) as directory:
            root = Path(directory)
            (root / "docs").mkdir()
            (root / "TZ.md").write_text(
                "## [P03_subscriptions]\nSUB-001 SUB-012\n## [P04_catalog]",
                encoding="utf-8",
            )
            (root / "docs/traceability.json").write_text("{}", encoding="utf-8")
            self.assertEqual(
                check(root, complete_p03=True),
                [
                    "Unmapped P03 requirement: SUB-001",
                    "Unmapped P03 requirement: SUB-012",
                ],
            )

    def test_complete_p02_rejects_unmapped_requirement(self) -> None:
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent) as directory:
            root = Path(directory)
            (root / "docs").mkdir()
            (root / "TZ.md").write_text(
                "## [P02_organizations]\nORG-001 VER-006\n## [P03_subscriptions]",
                encoding="utf-8",
            )
            (root / "docs/traceability.json").write_text("{}", encoding="utf-8")
            self.assertEqual(
                check(root, complete_p02=True),
                [
                    "Unmapped P02 requirement: ORG-001",
                    "Unmapped P02 requirement: VER-006",
                ],
            )

    def test_complete_p01_rejects_unmapped_requirement(self) -> None:
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent) as directory:
            root = Path(directory)
            (root / "docs").mkdir()
            (root / "TZ.md").write_text(
                "## [P01_identity_access]\nIAM-001 IAM-016\n## [P02_organizations]",
                encoding="utf-8",
            )
            (root / "docs/traceability.json").write_text("{}", encoding="utf-8")
            self.assertEqual(
                check(root, complete_p01=True),
                [
                    "Unmapped P01 requirement: IAM-001",
                    "Unmapped P01 requirement: IAM-016",
                ],
            )

    def test_complete_p00_rejects_unmapped_requirement(self) -> None:
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent) as directory:
            root = Path(directory)
            (root / "docs").mkdir()
            (root / "TZ.md").write_text(
                "## [P00_foundation]\nFND-000 FND-004\n## [P01_identity_access]",
                encoding="utf-8",
            )
            (root / "docs/traceability.json").write_text("{}", encoding="utf-8")
            self.assertEqual(len(check(root, complete_p00=True)), 2)

    def test_complete_p07_rejects_unmapped_requirement(self) -> None:
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent) as directory:
            root = Path(directory)
            (root / "docs").mkdir()
            (root / "TZ.md").write_text("## [P07_orders]\nORD-001 ORD-044\n## [P08_delivery]", encoding="utf-8")
            (root / "docs/traceability.json").write_text("{}", encoding="utf-8")
            self.assertEqual(len(check(root, complete_p07=True)), 2)

    def test_valid_reference_and_missing_test(self) -> None:
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent) as directory:
            root = Path(directory)
            (root / "docs").mkdir()
            (root / "TZ.md").write_text("FND-004", encoding="utf-8")
            (root / "tests.py").write_text("async def test_transaction(): pass", encoding="utf-8")
            manifest = root / "docs/traceability.json"
            manifest.write_text(
                json.dumps({"FND-004": ["tests.py::test_transaction"]}),
                encoding="utf-8",
            )
            self.assertEqual(check(root), [])
            (root / "tests.py").write_text("async def renamed(): pass", encoding="utf-8")
            self.assertIn("test function not found", check(root)[0])
            manifest.write_text(json.dumps({"FAKE-999": []}), encoding="utf-8")
            self.assertEqual(len(check(root)), 2)
            (root / "feature.test.ts").write_text("it('sends headers', () => {});", encoding="utf-8")
            manifest.write_text(
                json.dumps({"FND-004": ["feature.test.ts::sends headers"]}),
                encoding="utf-8",
            )
            self.assertEqual(check(root), [])
            (root / "feature.test.ts").write_text("it('renamed', () => {});", encoding="utf-8")
            self.assertIn("test title not found", check(root)[0])
