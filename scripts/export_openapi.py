"""Export the API contract locally, without starting a server or connecting to the database."""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

if __name__ == "__main__":
    from app.main import create_app

    target = ROOT / "frontend/openapi.json"
    target.write_text(json.dumps(create_app().openapi(), indent=2) + "\n", encoding="utf-8")
    print("Exported frontend/openapi.json")
