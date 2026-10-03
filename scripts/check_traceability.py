"""Validate the explicitly tracked requirement/test manifest without importing test modules.

The manifest is incremental: passing this check does not imply full TZ coverage.
"""

import ast
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def check(root: Path) -> list[str]:
    manifest = json.loads((root / "docs/traceability.json").read_text(encoding="utf-8"))
    requirements = set(re.findall(r"\b[A-Z]{2,8}-\d{3}\b", (root / "TZ.md").read_text(encoding="utf-8")))
    errors = []
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
                elif path.suffix in {".ts", ".tsx"} and ".test." in path.name:
                    # Static Vitest titles only; no imports or execution of frontend code.
                    pattern = r"\b(?:it|test)\s*\(\s*(['\"])" + re.escape(function) + r"\1"
                    if not re.search(pattern, source):
                        raise ValueError("test title not found")
                else:
                    raise ValueError("unsupported test file")
            except (ValueError, OSError, SyntaxError) as exc:
                errors.append(f"{requirement}: {reference}: {exc}")
    return errors


if __name__ == "__main__":
    problems = check(ROOT)
    for problem in problems:
        print(problem)
    if not problems:
        print("Tracked requirements have valid test references (incremental coverage only).")
    raise SystemExit(bool(problems))
