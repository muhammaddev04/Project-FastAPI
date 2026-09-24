# TezFarmo

B2B wholesale platform connecting **Companies** (suppliers/distributors) with **Stores**. The product specification is
[`TZ.md`](TZ.md); implementation follows its parts in order (P00 → P13). Current state: [`PART_REPORT.md`](PART_REPORT.md).

## Stack

- **Backend:** Python 3.12, FastAPI, SQLAlchemy 2.0 (async, asyncpg), Alembic, PostgreSQL 16, Redis 7, argon2, PyJWT.
- **Frontend:** React 18, TypeScript (strict), Vite, Tailwind, React Router 6, TanStack Query, Zustand, React Hook Form + Zod,
  i18next (`tg` default, `ru`, `en`).

## Local development

```bash
# services: PostgreSQL :5433, Redis :6380
docker compose up -d

# backend (API on :8001)
python -m venv .venv && .venv/Scripts/pip install -e "backend[dev]"   # or: pip install -r backend/requirements.txt
cp .env.example backend/.env
cd backend && ../.venv/Scripts/python -m alembic upgrade head
../.venv/Scripts/python -m uvicorn app.main:app --port 8001

# frontend (:5174, proxies /api to :8001)
cd frontend && npm ci && npm run dev
```

## Tests

```bash
# backend tests use their own PostgreSQL :5434 and Redis :6381 (SQLite is not accepted, TZ 01_GLOBAL §14)
docker compose -f docker-compose.test.yml up -d
cd backend && ../.venv/Scripts/python -m pytest && ../.venv/Scripts/python -m ruff check .

cd frontend && npm test && npm run lint && npm run build
```

Git rules (TZ 00_README §5): small Conventional Commits, no `git push` by tooling — the owner pushes.
