"""Validate the explicitly tracked requirement/test manifest without importing test modules.

The manifest is incremental: passing this check does not imply full TZ coverage.
"""

import argparse
import ast
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def check(
    root: Path,
    complete_p00: bool = False,
    complete_p01: bool = False,
    complete_p02: bool = False,
    complete_p03: bool = False,
    complete_p04: bool = False,
    complete_p05: bool = False,
    complete_p06: bool = False,
    complete_p07: bool = False,
    complete_p08: bool = False,
) -> list[str]:
    manifest = json.loads((root / "docs/traceability.json").read_text(encoding="utf-8"))
    requirements = set(re.findall(r"\b[A-Z]{2,8}-\d{3}\b", (root / "TZ.md").read_text(encoding="utf-8")))
    errors = []
    if complete_p00:
        specification = (root / "TZ.md").read_text(encoding="utf-8")
        section = specification.split("## [P00_foundation]", 1)[1].split("## [P01_identity_access]", 1)[0]
        required = set(re.findall(r"\bFND-\d{3}\b", section))
        errors.extend(f"Unmapped P00 requirement: {item}" for item in sorted(required - manifest.keys()))
    if complete_p01:
        specification = (root / "TZ.md").read_text(encoding="utf-8")
        section = specification.split("## [P01_identity_access]", 1)[1].split("## [P02_", 1)[0]
        required = set(re.findall(r"\bIAM-\d{3}\b", section))
        errors.extend(f"Unmapped P01 requirement: {item}" for item in sorted(required - manifest.keys()))
    if complete_p02:
        specification = (root / "TZ.md").read_text(encoding="utf-8")
        section = specification.split("## [P02_organizations]", 1)[1].split("## [P03_", 1)[0]
        required = set(re.findall(r"\b(?:ORG|VER)-\d{3}\b", section))
        errors.extend(f"Unmapped P02 requirement: {item}" for item in sorted(required - manifest.keys()))
    if complete_p03:
        specification = (root / "TZ.md").read_text(encoding="utf-8")
        section = specification.split("## [P03_subscriptions]", 1)[1].split("## [P04_", 1)[0]
        required = set(re.findall(r"\bSUB-\d{3}\b", section))
        errors.extend(f"Unmapped P03 requirement: {item}" for item in sorted(required - manifest.keys()))
    if complete_p04:
        specification = (root / "TZ.md").read_text(encoding="utf-8")
        section = specification.split("## [P04_catalog_pricing]", 1)[1].split("## [P05_", 1)[0]
        required = set(re.findall(r"\b(?:CAT|PRC|IMP)-\d{3}\b", section))
        errors.extend(f"Unmapped P04 requirement: {item}" for item in sorted(required - manifest.keys()))
    if complete_p05:
        specification = (root / "TZ.md").read_text(encoding="utf-8")
        section = specification.split("## [P05_inventory]", 1)[1].split("## [P06_", 1)[0]
        required = set(re.findall(r"\bINV-\d{3}\b", section))
        errors.extend(f"Unmapped P05 requirement: {item}" for item in sorted(required - manifest.keys()))
    if complete_p06:
        specification = (root / "TZ.md").read_text(encoding="utf-8")
        section = specification.split("## [P06_partnerships]", 1)[1].split("## [P07_", 1)[0]
        required = set(re.findall(r"\bPRT-\d{3}\b", section))
        errors.extend(f"Unmapped P06 requirement: {item}" for item in sorted(required - manifest.keys()))
    if complete_p07:
        specification = (root / "TZ.md").read_text(encoding="utf-8")
        section = specification.split("## [P07_orders]", 1)[1].split("## [P08_", 1)[0]
        required = set(re.findall(r"\bORD-\d{3}\b", section))
        errors.extend(f"Unmapped P07 requirement: {item}" for item in sorted(required - manifest.keys()))
    if complete_p08:
        specification = (root / "TZ.md").read_text(encoding="utf-8")
        section = specification.split("## [P08_delivery]", 1)[1].split("## [P09_", 1)[0]
        required = set(re.findall(r"\bDEL-\d{3}\b", section))
        errors.extend(f"Unmapped P08 requirement: {item}" for item in sorted(required - manifest.keys()))
    for requirement, references in manifest.items():
        if requirement not in requirements:
            errors.append(f"Unknown requirement: {requirement}")
        if not references:
            errors.append(f"No tests: {requirement}")
        for reference in references:
            try:
                filename, function = reference.split("::")
                path = (root / filename).resolve()
                if not path.is_relative_to(root.resolve()):
                    raise ValueError("test outside repository")
                source = path.read_text(encoding="utf-8")
                if path.suffix == ".py":
                    tree = ast.parse(source)
                    names = {
                        node.name
                        for node in ast.walk(tree)
                        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
                    }
                    if not function.startswith("test_") or function not in names:
                        raise ValueError("test function not found")
                elif path.suffix in {".ts", ".tsx"} and any(s in path.name for s in (".test.", ".spec.")):
                    # Static Vitest titles only; no imports or execution of frontend code.
                    pattern = r"\b(?:it|test)\s*\(\s*(['\"`])" + re.escape(function) + r"\1"
                    if not re.search(pattern, source):
                        raise ValueError("test title not found")
                else:
                    raise ValueError("unsupported test file")
            except (ValueError, OSError, SyntaxError) as exc:
                errors.append(f"{requirement}: {reference}: {exc}")
    return errors


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--complete-p00", action="store_true")
    parser.add_argument("--complete-p01", action="store_true")
    parser.add_argument("--complete-p02", action="store_true")
    parser.add_argument("--complete-p03", action="store_true")
    parser.add_argument("--complete-p04", action="store_true")
    parser.add_argument("--complete-p05", action="store_true")
    parser.add_argument("--complete-p06", action="store_true")
    parser.add_argument("--complete-p07", action="store_true")
    parser.add_argument("--complete-p08", action="store_true")
    args = parser.parse_args()
    problems = check(
        ROOT,
        complete_p00=args.complete_p00,
        complete_p01=args.complete_p01,
        complete_p02=args.complete_p02,
        complete_p03=args.complete_p03,
        complete_p04=args.complete_p04,
        complete_p05=args.complete_p05,
        complete_p06=args.complete_p06,
        complete_p07=args.complete_p07,
        complete_p08=args.complete_p08,
    )
    for problem in problems:
        print(problem)
    if not problems:
        print("Tracked references valid. Reference completeness is not acceptance of the specification.")
    raise SystemExit(bool(problems))
