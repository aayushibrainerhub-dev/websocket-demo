FROM python:3.11-slim

WORKDIR /app

# Install system dependencies and Node.js/npm
RUN apt-get update && apt-get install -y \
    gcc \
    postgresql-client \
    nodejs \
    npm \
    && rm -rf /var/lib/apt/lists/*

# Install uv
RUN pip install --no-cache-dir uv

# Copy Python dependency and source metadata
COPY pyproject.toml README.md uv.lock ./
COPY src ./src

# Install Python dependencies
RUN uv sync --frozen --no-dev --no-install-project

# Copy application files
COPY apps ./apps
COPY alembic ./alembic
COPY alembic.ini ./
COPY main.py ./
COPY templates ./templates
COPY voices ./voices

# Copy frontend package files
COPY package.json package-lock.json ./

# Install frontend dependencies and build JavaScript
RUN npm ci && npm run build

# Create non-root user
RUN useradd -m -u 1000 appuser && \
    chown -R appuser:appuser /app

USER appuser

EXPOSE 8000

CMD ["uv", "run", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
