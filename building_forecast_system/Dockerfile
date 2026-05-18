FROM python:3.11-slim

WORKDIR /app

# System dependencies:
# - build-essential: needed for some Python packages during install
# - libpq-dev: PostgreSQL client/build headers
# - libgomp1: needed by xgboost on Linux
# - curl: useful for debugging inside the container
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        libpq-dev \
        libgomp1 \
        curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

RUN pip install --no-cache-dir --upgrade pip setuptools wheel \
    && pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p \
    /app/data/raw \
    /app/data/processed \
    /app/data/forecasts \
    /app/data/metrics \
    /app/artifacts/models/short_term \
    /app/artifacts/models/long_term \
    /app/artifacts/models/global_short_term \
    /app/artifacts/models/global_long_term

ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app
ENV TZ=Europe/Sofia

CMD ["python", "-m", "app.pipelines.scheduler"]