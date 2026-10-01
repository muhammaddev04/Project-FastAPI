# TezFarmo API production image.
# Migrations are deliberately NOT run here: deployment applies them explicitly with
# `docker compose -f docker-compose.prod.yml run --rm --no-deps backend alembic upgrade head`
# (see docs/deployment.md), so a container restart can never migrate the database on its own.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app

WORKDIR /app

COPY pyproject.toml requirements.txt ./
COPY app ./app
COPY migrations ./migrations
COPY alembic.ini ./

RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir .

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
