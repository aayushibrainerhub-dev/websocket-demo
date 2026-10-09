FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Install uv
RUN pip install --no-cache-dir uv

# Copy dependency and source package metadata first so uv can resolve the project
COPY pyproject.toml uv.lock ./
COPY src ./src

# Install dependencies from uv.lock
RUN uv sync --frozen --no-dev --no-install-project

# Copy application files
COPY apps ./apps
COPY alembic ./alembic
COPY alembic.ini ./
COPY main.py ./
COPY templates ./templates
COPY voices ./voices

# Create non-root user
RUN useradd -m -u 1000 appuser && \
    chown -R appuser:appuser /app

USER appuser

EXPOSE 8000

CMD ["uv", "run", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]