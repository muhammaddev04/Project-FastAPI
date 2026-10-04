"""Validate the explicitly tracked requirement/test manifest without importing test modules.

The manifest is incremental: passing this check does not imply full TZ coverage.
"""

import argparse
import ast
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def check(root: Path, complete_p00: bool = False, complete_p01: bool = False) -> list[str]:
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
    args = parser.parse_args()
    problems = check(ROOT, complete_p00=args.complete_p00, complete_p01=args.complete_p01)
    for problem in problems:
        print(problem)
    if not problems:
        print("Tracked references valid. Reference completeness is not acceptance of the specification.")
    raise SystemExit(bool(problems))
