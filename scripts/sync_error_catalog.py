"""Check error-code locale coverage; --write adds localized fallback messages for future modules."""

import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FALLBACKS = {
    "tg": "Амалиёт иҷро нашуд. Маълумотро санҷида, аз нав кӯшиш кунед.",
    "ru": "Не удалось выполнить действие. Проверьте данные и повторите попытку.",
    "en": "The operation could not be completed. Check the details and try again.",
}


def check(write: bool = False) -> list[str]:
    specification = (ROOT / "TZ.md").read_text(encoding="utf-8")
    section = specification.split("## [02_ERROR_CODES]")[1].split("## [P00_foundation]")[0]
    codes = set(re.findall(r"\|\s*`([a-z][a-z0-9_]+)`", section))
    if not codes:
        raise ValueError("error catalog is empty")
    missing = []
    for language, fallback in FALLBACKS.items():
        for location in ("backend/app/locales", "frontend/src/shared/i18n"):
            path = ROOT / location / f"{language}.json"
            document = json.loads(path.read_text(encoding="utf-8"))
            messages = document if location.startswith("backend") else document["errors"]
            for code in sorted(codes):
                key = f"errors.{code}" if location.startswith("backend") else code
                if key not in messages:
                    missing.append(f"{location}/{language}: {code}")
                    if write:
                        messages[key] = fallback
            if write:
                path.write_text(
                    json.dumps(document, ensure_ascii=False, indent=2) + "\n",
                    encoding="utf-8",
                )
    return missing


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    missing = check(args.write)
    print(f"Error catalog: {len(missing)} {'fallbacks added' if args.write else 'missing locale keys'}")
    raise SystemExit(bool(missing) and not args.write)
