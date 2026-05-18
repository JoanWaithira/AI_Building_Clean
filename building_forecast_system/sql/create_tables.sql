-- ============================================
-- 1. Cache of circuit data fetched from source API
-- ============================================
CREATE TABLE IF NOT EXISTS source_circuit_history (
    id BIGSERIAL PRIMARY KEY,
    circuit_id TEXT NOT NULL,
    timestamp TIMESTAMP NOT NULL,
    value DOUBLE PRECISION NOT NULL,
    source_resolution TEXT,
    fetched_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (circuit_id, timestamp)
);

CREATE INDEX IF NOT EXISTS idx_source_circuit_history_circuit_ts
ON source_circuit_history (circuit_id, timestamp);

CREATE INDEX IF NOT EXISTS idx_source_circuit_history_fetched_at
ON source_circuit_history (fetched_at);


-- ============================================
-- 2. Cache of room/environment data fetched from source API
-- ============================================
CREATE TABLE IF NOT EXISTS source_room_history (
    id BIGSERIAL PRIMARY KEY,
    room_id TEXT NOT NULL,
    sensor_type TEXT NOT NULL,
    timestamp TIMESTAMP NOT NULL,
    value DOUBLE PRECISION NOT NULL,
    source_resolution TEXT,
    fetched_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (room_id, sensor_type, timestamp)
);

CREATE INDEX IF NOT EXISTS idx_source_room_history_room_sensor_ts
ON source_room_history (room_id, sensor_type, timestamp);

CREATE INDEX IF NOT EXISTS idx_source_room_history_fetched_at
ON source_room_history (fetched_at);


-- ============================================
-- 3. Short-term forecasts (next 24 hours)
-- ============================================
CREATE TABLE IF NOT EXISTS forecast_short_term (
    id BIGSERIAL PRIMARY KEY,
    circuit_id TEXT NOT NULL,
    forecast_timestamp TIMESTAMP NOT NULL,
    forecast_value DOUBLE PRECISION NOT NULL,
    step_ahead INTEGER NOT NULL,
    generated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    model_type TEXT NOT NULL,
    model_version TEXT NOT NULL,
    resolution TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_forecast_short_term_circuit_res_ts
ON forecast_short_term (circuit_id, resolution, forecast_timestamp);

CREATE INDEX IF NOT EXISTS idx_forecast_short_term_generated_at
ON forecast_short_term (generated_at);


-- ============================================
-- 4. Long-term forecasts (next 1 month)
-- ============================================
CREATE TABLE IF NOT EXISTS forecast_long_term (
    id BIGSERIAL PRIMARY KEY,
    circuit_id TEXT NOT NULL,
    forecast_timestamp TIMESTAMP NOT NULL,
    forecast_value DOUBLE PRECISION NOT NULL,
    step_ahead INTEGER NOT NULL,
    generated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    model_type TEXT NOT NULL,
    model_version TEXT NOT NULL,
    resolution TEXT NOT NULL,
    confidence_lower DOUBLE PRECISION,
    confidence_upper DOUBLE PRECISION
);

CREATE INDEX IF NOT EXISTS idx_forecast_long_term_circuit_res_ts
ON forecast_long_term (circuit_id, resolution, forecast_timestamp);

CREATE INDEX IF NOT EXISTS idx_forecast_long_term_generated_at
ON forecast_long_term (generated_at);


-- ============================================
-- 5. Global forecasts (all circuits combined)
-- ============================================
CREATE TABLE IF NOT EXISTS forecast_global (
    id BIGSERIAL PRIMARY KEY,
    forecast_timestamp TIMESTAMP NOT NULL,
    global_prediction DOUBLE PRECISION NOT NULL,
    step_ahead INTEGER NOT NULL,
    generated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    model_version TEXT NOT NULL,
    resolution TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_forecast_global_ts
ON forecast_global (forecast_timestamp);

CREATE INDEX IF NOT EXISTS idx_forecast_global_generated_at
ON forecast_global (generated_at);


-- ============================================
-- 6. Model metadata / registry
-- ============================================
CREATE TABLE IF NOT EXISTS model_metadata (
    id BIGSERIAL PRIMARY KEY,
    circuit_id TEXT,
    horizon_type TEXT NOT NULL,
    model_type TEXT NOT NULL,
    model_version TEXT NOT NULL UNIQUE,
    model_path TEXT NOT NULL,
    scaler_path TEXT,
    validation_rmse DOUBLE PRECISION,
    test_rmse DOUBLE PRECISION,
    trained_at TIMESTAMP NOT NULL DEFAULT NOW(),
    is_active BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_model_metadata_circuit_horizon
ON model_metadata (circuit_id, horizon_type);

CREATE INDEX IF NOT EXISTS idx_model_metadata_is_active
ON model_metadata (is_active);


-- ============================================
-- 7. Unified forecast snapshots used by inference reloads
-- ============================================
CREATE TABLE IF NOT EXISTS unified_local_short_term (
    circuit_id TEXT NOT NULL,
    forecast_timestamp TIMESTAMP NOT NULL,
    forecast_value DOUBLE PRECISION NOT NULL,
    step_ahead INTEGER,
    generated_at TIMESTAMP NOT NULL,
    model_type TEXT,
    model_version TEXT,
    resolution TEXT,
    PRIMARY KEY (circuit_id, forecast_timestamp, resolution)
);

CREATE TABLE IF NOT EXISTS unified_local_long_term (
    circuit_id TEXT NOT NULL,
    forecast_timestamp TIMESTAMP NOT NULL,
    forecast_value DOUBLE PRECISION NOT NULL,
    step_ahead INTEGER,
    generated_at TIMESTAMP NOT NULL,
    model_type TEXT,
    model_version TEXT,
    resolution TEXT,
    PRIMARY KEY (circuit_id, forecast_timestamp, resolution)
);

CREATE TABLE IF NOT EXISTS unified_global_short_term (
    circuit_id TEXT NOT NULL,
    forecast_timestamp TIMESTAMP NOT NULL,
    forecast_value DOUBLE PRECISION NOT NULL,
    step_ahead INTEGER,
    generated_at TIMESTAMP NOT NULL,
    model_type TEXT,
    model_version TEXT,
    resolution TEXT,
    PRIMARY KEY (circuit_id, forecast_timestamp, resolution)
);

CREATE TABLE IF NOT EXISTS unified_global_long_term (
    circuit_id TEXT NOT NULL,
    forecast_timestamp TIMESTAMP NOT NULL,
    forecast_value DOUBLE PRECISION NOT NULL,
    step_ahead INTEGER,
    generated_at TIMESTAMP NOT NULL,
    model_type TEXT,
    model_version TEXT,
    resolution TEXT,
    PRIMARY KEY (circuit_id, forecast_timestamp, resolution)
);


-- ============================================
-- 8. Pipeline execution history
-- ============================================
CREATE TABLE IF NOT EXISTS pipeline_run_history (
    id BIGSERIAL PRIMARY KEY,
    pipeline_name TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at TIMESTAMP NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMP,
    details_json TEXT,
    error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_pipeline_run_history_name_started
ON pipeline_run_history (pipeline_name, started_at DESC);