from __future__ import annotations

from datetime import timedelta
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from tensorflow.keras.models import load_model

from app.models.inference_features import build_tabular_feature_row
from app.models.sequence_features import build_multivariate_sequence_row
from app.utils.forecast_store import persist_unified_forecasts
from app.utils.db_writers import write_short_forecast_to_db
from app.utils.plotting import plot_inference_forecast
from app.utils.run_tracking import finish_pipeline_run, start_pipeline_run

PROCESSED_DIR = Path("data/processed")
MODEL_DIR = Path("artifacts/models/short_term")
FORECAST_DIR = Path("data/forecasts")

FORECAST_DIR.mkdir(parents=True, exist_ok=True)


def load_latest_history(file_path: Path) -> pd.DataFrame:
    df = pd.read_csv(file_path)
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
    df = df.sort_values("timestamp").reset_index(drop=True)
    return df


def run_tabular_recursive_forecast(
    history_df: pd.DataFrame,
    model_bundle: dict,
    steps: int = 288,
) -> pd.DataFrame:
    model = model_bundle["model"]
    feature_cols = model_bundle["feature_cols"]
    circuit_id = model_bundle["circuit_id"]
    model_type = model_bundle["model_type"]

    # Keep only as much history as the feature builder needs (max lag/rolling = 288).
    _MAX_SHORT_HISTORY = 288 + 1
    work = history_df[["timestamp", "value"]].tail(_MAX_SHORT_HISTORY).copy()
    forecasts = []
    generated_at = pd.Timestamp.now("UTC")
    last_ts = work["timestamp"].iloc[-1]

    for step in range(1, steps + 1):
        next_ts = last_ts + timedelta(minutes=5)
        X_next = build_tabular_feature_row(
            history_df=work,
            next_timestamp=next_ts,
            feature_cols=feature_cols,
        )
        X_next = X_next.apply(pd.to_numeric, errors="coerce")

        pred = float(model.predict(X_next)[0])
        pred = max(0.0, pred)

        forecasts.append(
            {
                "circuit_id": circuit_id,
                "forecast_timestamp": next_ts,
                "forecast_value": pred,
                "step_ahead": step,
                "generated_at": generated_at,
                "model_type": model_type,
                "model_version": f"{circuit_id}_best_short_model",
                "resolution": "5min",
            }
        )

        new_row = pd.DataFrame([{"timestamp": next_ts, "value": pred}])
        work = pd.concat([work.iloc[1:], new_row], ignore_index=True)
        last_ts = next_ts

    return pd.DataFrame(forecasts)


def run_deep_recursive_forecast(
    history_df: pd.DataFrame,
    keras_model,
    metadata: dict,
    steps: int = 288,
) -> pd.DataFrame:
    lookback = metadata["lookback"]
    circuit_id = metadata["circuit_id"]
    model_type = metadata["model_type"]

    # Keep a rolling window of the last lookback rows — no need for older history.
    # This prevents unbounded DataFrame growth across 288 forecast steps.
    work = history_df[["timestamp", "value"]].tail(lookback).copy()
    work["timestamp"] = pd.to_datetime(work["timestamp"], utc=True)
    last_ts = work["timestamp"].iloc[-1]

    forecasts = []
    generated_at = pd.Timestamp.now("UTC")

    for step in range(1, steps + 1):
        next_ts = last_ts + timedelta(minutes=5)

        seq = build_multivariate_sequence_row(work, lookback)

        pred = float(keras_model.predict(seq, verbose=0).flatten()[0])
        pred = max(0.0, pred)

        forecasts.append(
            {
                "circuit_id": circuit_id,
                "forecast_timestamp": next_ts,
                "forecast_value": pred,
                "step_ahead": step,
                "generated_at": generated_at,
                "model_type": model_type,
                "model_version": f"{circuit_id}_best_short_model",
                "resolution": "5min",
            }
        )

        new_row = pd.DataFrame([{"timestamp": next_ts, "value": pred}])
        work = pd.concat([work.iloc[1:], new_row], ignore_index=True)
        last_ts = next_ts

    return pd.DataFrame(forecasts)


def infer_one_circuit(
    clean_file: Path, history_points_for_plot: int = 288
) -> pd.DataFrame | None:
    circuit_id = clean_file.name.replace("_clean.csv", "")
    print(f"\nRunning short inference for: {circuit_id}")

    history_df = load_latest_history(clean_file)
    if history_df.empty or len(history_df) < 300:
        print(f"Skipping {circuit_id}: not enough cleaned history")
        return None

    joblib_model_file = MODEL_DIR / f"{circuit_id}_best_short_model.joblib"
    keras_model_file = MODEL_DIR / f"{circuit_id}_best_short_model.keras"
    keras_metadata_file = MODEL_DIR / f"{circuit_id}_best_short_model_metadata.joblib"

    forecast_df = None

    if joblib_model_file.exists():
        print(f"  Found tabular model: {joblib_model_file}")
        model_bundle = joblib.load(joblib_model_file)
        forecast_df = run_tabular_recursive_forecast(
            history_df=history_df,
            model_bundle=model_bundle,
            steps=288,
        )
    elif keras_model_file.exists() and keras_metadata_file.exists():
        print(f"  Found deep model: {keras_model_file}")
        keras_model = load_model(keras_model_file)
        metadata = joblib.load(keras_metadata_file)
        forecast_df = run_deep_recursive_forecast(
            history_df=history_df,
            keras_model=keras_model,
            metadata=metadata,
            steps=288,
        )
    else:
        print(f"  No saved best model found for {circuit_id}")
        return None

    output_file = FORECAST_DIR / f"{circuit_id}_short_forecast.csv"
    forecast_df.to_csv(output_file, index=False)
    print(f"  Saved forecast -> {output_file}")

    try:
        write_short_forecast_to_db(forecast_df)
        print(f"  Wrote {len(forecast_df)} short forecast rows to database")
    except Exception as exc:
        print(f"  Database write failed for {circuit_id} short forecast: {exc}")

    history_for_plot = history_df.tail(history_points_for_plot).copy()
    try:
        plot_inference_forecast(
            history_df=history_for_plot,
            forecast_df=forecast_df,
            circuit_id=circuit_id,
            horizon_type="short",
        )
    except Exception as exc:
        print(f"  Forecast plotting skipped for {circuit_id}: {exc}")

    return forecast_df


def run() -> None:
    run_id = start_pipeline_run("run_short_inference")
    clean_files = [
        file
        for file in PROCESSED_DIR.glob("*_clean.csv")
        if file.name not in {"global_clean.csv", "global_hourly_clean.csv"}
    ]

    try:
        if not clean_files:
            print("No cleaned circuit files found.")
            finish_pipeline_run(
                run_id,
                status="completed",
                details={
                    "clean_file_count": 0,
                    "forecast_batches": 0,
                    "forecast_row_count": 0,
                },
            )
            return

        print(f"Found {len(clean_files)} cleaned circuit files for short inference")

        unified_frames: list[pd.DataFrame] = []

        for clean_file in clean_files:
            try:
                forecast_df = infer_one_circuit(clean_file)
                if forecast_df is not None and not forecast_df.empty:
                    unified_frames.append(forecast_df)
            except Exception as exc:
                print(f"Failed inference for {clean_file.name}: {exc}")

        forecast_row_count = 0
        if unified_frames:
            combined_forecast_df = pd.concat(unified_frames, ignore_index=True)
            forecast_row_count = len(combined_forecast_df)
            persist_result = persist_unified_forecasts(
                combined_forecast_df,
                scope="local",
                horizon="short",
            )
            print(
                f"Saved unified local short-term forecast -> {persist_result['csv_path']}"
            )
            if persist_result["db_written"]:
                print(f"Updated database table -> {persist_result['table_name']}")

        finish_pipeline_run(
            run_id,
            status="completed",
            details={
                "clean_file_count": len(clean_files),
                "forecast_batches": len(unified_frames),
                "forecast_row_count": forecast_row_count,
            },
        )
        print("\nFinished short-term inference job")
    except Exception as exc:
        finish_pipeline_run(run_id, status="failed", error_message=str(exc))
        raise


if __name__ == "__main__":
    run()
