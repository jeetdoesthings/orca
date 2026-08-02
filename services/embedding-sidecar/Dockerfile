# CPU-only embedding sidecar (Part 14). No GPU.
FROM python:3.11-slim

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Default: stub mode boots instantly for CI/dev. Set ORCA_EMBED_MODE=clap + install torch for real.
ENV ORCA_EMBED_MODE=stub
ENV ORCA_EMBEDDING_MODEL_ID=clap-http-v1

COPY app ./app

EXPOSE 8080
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
