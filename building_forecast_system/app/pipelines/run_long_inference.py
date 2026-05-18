from pathlib import Path
from datetime import timedelta
import joblib
import pandas as pd
from tensorflow.keras.models import load_model

from app.models.long_term_features import resample_hourly
from app.models.sequence_features import build_long_multivariate_sequence_row, LONG_LOOKBACK
from app.utils.cyclic_features import add_cyclic_encoding
from app.utils.db_writers import write_long_forecast_to_db
from app.utils.forecast_store import persist_unified_forecasts
from app.utils.plotting import plot_inference_forecast
from app.utils.run_tracking import finish_pipeline_run, start_pipeline_run


PROCESSED_DIR = Path("data/processed")
MODEL_DIR = Path("artifacts/models/long_term")
FORECAST_DIR = Path("data/forecasts")

FORECAST_DIR.mkdir(parents=True, exist_ok=True)


def load_latest_history(file_path: Path) -> pd.DataFrame:
    df = pd.read_csv(file_path)
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
    df = df.sort_values("timestamp").reset_index(drop=True)
    return df


def build_long_feature_row(history_df: pd.DataFrame, next_timestamp: pd.Timestamp, feature_cols: list[str]) -> pd.DataFrame:
    temp = history_df.copy()
    new_row = pd.DataFrame([{"timestamp": next_timestamp, "value": temp["value"].iloc[-1]}])
    temp = pd.concat([temp, new_row], ignore_index=True)

    temp["timestamp"] = pd.to_datetime(temp["timestamp"], utc=True)

    # Mirror long_term_features.add_time_features() exactly.
    temp["hour"] = temp["timestamp"].dt.hour
    temp["day_of_week"] = temp["timestamp"].dt.dayofweek
    temp["month"] = temp["timestamp"].dt.month
    temp["day_of_month"] = temp["timestamp"].dt.day
    temp["is_weekend"] = temp["day_of_week"].isin([5, 6]).astype(int)
    temp = add_cyclic_encoding(temp)

    for lag in [1, 2, 3, 6, 12, 24, 24 * 7]:
        temp[f"lag_{lag}"] = temp["value"].shift(lag)

    temp["roll_mean_6"] = temp["value"].rolling(6).mean()
    temp["roll_std_6"] = temp["value"].rolling(6).std()
    temp["roll_mean_24"] = temp["value"].rolling(24).mean()
    temp["roll_mean_168"] = temp["value"].rolling(24 * 7).mean()

    row = temp.iloc[[-1]].copy()
    return row[feature_cols]


_MAX_LONG_HISTORY = 24 * 7 + 1  # max lag/rolling window needed by build_long_feature_row


def run_long_recursive_forecast(history_df: pd.DataFrame, model_bundle: dict, steps: int = 24 * 30) -> pd.DataFrame:
    model = model_bundle["model"]
    feature_cols = model_bundle["feature_cols"]
    circuit_id = model_bundle["circuit_id"]
    model_type = model_bundle["model_type"]

   
    work = history_df[["timestamp", "value"]].tail(_MAX_LONG_HISTORY).copy()
    forecasts = []
    generated_at = pd.Timestamp.now("UTC")

    last_ts = work["timestamp"].iloc[-1]

    for step in range(1, steps + 1):
        next_ts = last_ts + timedelta(hours=1)

        X_next = build_long_feature_row(
            history_df=work,
            next_timestamp=next_ts,
            feature_cols=feature_cols,
        )

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
                "model_version": f"{circuit_id}_best_long_model",
                "resolution": "1h",
            }
        )

        new_row = pd.DataFrame([{"timestamp": next_ts, "value": pred}])
        work = pd.concat([work.iloc[1:], new_row], ignore_index=True)
        last_ts = next_ts

    return pd.DataFrame(forecasts)


def run_long_deep_recursive_forecast(
    history_df: pd.DataFrame,
    keras_model,
    metadata: dict,
    steps: int = 24 * 30,
) -> pd.DataFrame:
    lookback = metadata["lookback"]
    circuit_id = metadata["circuit_id"]
    model_type = metadata["model_type"]

    # Maintain a rolling window of exactly `lookback` hourly rows.
    work = history_df[["timestamp", "value"]].tail(lookback).copy()
    work["timestamp"] = pd.to_datetime(work["timestamp"], utc=True)
    last_ts = work["timestamp"].iloc[-1]

    forecasts = []
    generated_at = pd.Timestamp.now("UTC")

    for step in range(1, steps + 1):
        next_ts = last_ts + timedelta(hours=1)

        seq = build_long_multivariate_sequence_row(work, lookback)

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
                "model_version": f"{circuit_id}_best_long_model",
                "resolution": "1h",
            }
        )

        new_row = pd.DataFrame([{"timestamp": next_ts, "value": pred}])
        work = pd.concat([work.iloc[1:], new_row], ignore_index=True)
        last_ts = next_ts

    return pd.DataFrame(forecasts)


def infer_one_circuit(clean_file: Path, history_points_for_plot: int = 24 * 7):
    circuit_id = clean_file.name.replace("_clean.csv", "")
    print(f"\nRunning long inference for: {circuit_id}")

    history_df = load_latest_history(clean_file)
    history_df = resample_hourly(history_df)

    if history_df.empty or len(history_df) < 24 * 14:
        print(f"Skipping {circuit_id}: not enough hourly history")
        return None

    joblib_model_file = MODEL_DIR / f"{circuit_id}_best_long_model.joblib"
    keras_model_file = MODEL_DIR / f"{circuit_id}_best_long_model.keras"
    keras_metadata_file = MODEL_DIR / f"{circuit_id}_best_long_model_metadata.joblib"

    forecast_df = None

    if joblib_model_file.exists():
        print(f"  Found long-term tabular model: {joblib_model_file}")
        model_bundle = joblib.load(joblib_model_file)
        forecast_df = run_long_recursive_forecast(
            history_df=history_df,
            model_bundle=model_bundle,
            steps=24 * 30,
        )
    elif keras_model_file.exists() and keras_metadata_file.exists():
        print(f"  Found long-term deep model: {keras_model_file}")
        keras_model = load_model(keras_model_file)
        metadata = joblib.load(keras_metadata_file)
        forecast_df = run_long_deep_recursive_forecast(
            history_df=history_df,
            keras_model=keras_model,
            metadata=metadata,
            steps=24 * 30,
        )
    else:
        print(f"  No saved best long-term model found for {circuit_id}")
        return None

    output_file = FORECAST_DIR / f"{circuit_id}_long_forecast.csv"
    forecast_df.to_csv(output_file, index=False)
    print(f"  Saved long forecast -> {output_file}")

    try:
        write_long_forecast_to_db(forecast_df)
        print(f"  Wrote {len(forecast_df)} long forecast rows to database")
    except Exception as exc:
        print(f"  Database write failed for {circuit_id} long forecast: {exc}")

    history_for_plot = history_df.tail(history_points_for_plot).copy()

    plot_inference_forecast(
        history_df=history_for_plot,
        forecast_df=forecast_df,
        circuit_id=circuit_id,
        horizon_type="long",
    )

    return forecast_df


def run():
    run_id = start_pipeline_run("run_long_inference")
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
                details={"clean_file_count": 0, "forecast_batches": 0, "forecast_row_count": 0},
            )
            return

        print(f"Found {len(clean_files)} cleaned circuit files for long inference")

        unified_frames = []

        for clean_file in clean_files:
            try:
                forecast_df = infer_one_circuit(clean_file)
                if forecast_df is not None and not forecast_df.empty:
                    unified_frames.append(forecast_df)
            except Exception as e:
                print(f"Failed long inference for {clean_file.name}: {e}")

        forecast_row_count = 0
        if unified_frames:
            combined_forecast_df = pd.concat(unified_frames, ignore_index=True)
            forecast_row_count = len(combined_forecast_df)
            persist_result = persist_unified_forecasts(
                combined_forecast_df,
                scope="local",
                horizon="long",
            )
            print(f"Saved unified local long-term forecast -> {persist_result['csv_path']}")
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
        print("\nFinished long-term inference job")
    except Exception as exc:
        finish_pipeline_run(run_id, status="failed", error_message=str(exc))
        raise


if __name__ == "__main__":
    run()
