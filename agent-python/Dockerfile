FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    AGENT_DATA_DIR=/app/data \
    AGENT_WORKSPACE=/app/workspace

WORKDIR /app

# Install system dependencies including git
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Create non-root user and app folders
RUN useradd -m -u 1000 agentuser && \
    mkdir -p /app/data /app/workspace && \
    chown -R agentuser:agentuser /app

COPY --chown=agentuser:agentuser . .

USER agentuser

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8787/health || exit 1

CMD ["python", "main.py"]
