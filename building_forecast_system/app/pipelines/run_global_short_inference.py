from pathlib import Path
import joblib
import pandas as pd

from app.utils.db_writers import write_global_forecast_to_db
from app.utils.forecast_store import persist_unified_forecasts
from app.utils.plotting import plot_forecast_series
from app.utils.run_tracking import finish_pipeline_run, start_pipeline_run


PROCESSED_DIR = Path("data/processed")
FORECASTS_DIR = Path("data/forecasts")
MODEL_DIR = Path("artifacts/models/global")

GLOBAL_FILE = PROCESSED_DIR / "global_hourly_clean.csv"
WEATHER_FORECAST_FILE = PROCESSED_DIR / "weather_forecast_hourly.csv"
MODEL_FILE = MODEL_DIR / "global_best_short_hourly_model.joblib"
OUTPUT_FILE = FORECASTS_DIR / "global_short_hourly_forecast.csv"

FORECASTS_DIR.mkdir(parents=True, exist_ok=True)


def add_feature_columns(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    ts = pd.to_datetime(df["timestamp"], utc=True)

    df["value"] = pd.to_numeric(df["value"], errors="coerce")
    for col in ["temperature", "humidity", "pressure", "clouds", "wind_speed", "rain_1h", "snow_1h"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    df["hour"] = ts.dt.hour
    df["day_of_week"] = ts.dt.dayofweek
    df["day_of_month"] = ts.dt.day
    df["month"] = ts.dt.month
    df["day_of_year"] = ts.dt.dayofyear
    df["week_of_year"] = ts.dt.isocalendar().week.astype(int)
    df["is_weekend"] = ts.dt.dayofweek.isin([5, 6]).astype(int)

    for lag in [1, 2, 3, 6, 12, 24, 48, 72, 168]:
        df[f"lag_{lag}"] = df["value"].shift(lag)

    for window in [3, 6, 12, 24, 168]:
        df[f"roll_mean_{window}"] = df["value"].rolling(window).mean()
        df[f"roll_std_{window}"] = df["value"].rolling(window).std()

    weather_cols = [
        c
        for c in ["temperature", "humidity", "pressure", "clouds", "wind_speed", "rain_1h", "snow_1h"]
        if c in df.columns
    ]

    for col in weather_cols:
        for lag in [1, 3, 6, 24]:
            df[f"{col}_lag_{lag}"] = df[col].shift(lag)

    if "temperature" in df.columns:
        df["cooling_degree"] = (df["temperature"] - 18.0).clip(lower=0)
        df["heating_degree"] = (18.0 - df["temperature"]).clip(lower=0)
        df["temp_roll_mean_6"] = df["temperature"].rolling(6).mean()
        df["temp_roll_mean_24"] = df["temperature"].rolling(24).mean()

    if "humidity" in df.columns:
        df["humidity_roll_mean_6"] = df["humidity"].rolling(6).mean()

    if "wind_speed" in df.columns:
        df["wind_roll_mean_6"] = df["wind_speed"].rolling(6).mean()

    return df


def run() -> None:
    run_id = start_pipeline_run("run_global_short_inference")
    print("\nRunning GLOBAL short-term hourly inference")

    try:
        if not MODEL_FILE.exists():
            print(f"Model not found: {MODEL_FILE}")
            finish_pipeline_run(run_id, status="failed", error_message=f"Model not found: {MODEL_FILE}")
            return

        if not GLOBAL_FILE.exists():
            print(f"Global file not found: {GLOBAL_FILE}")
            finish_pipeline_run(run_id, status="failed", error_message=f"Global file not found: {GLOBAL_FILE}")
            return

        if not WEATHER_FORECAST_FILE.exists():
            print(f"Weather forecast file not found: {WEATHER_FORECAST_FILE}")
            finish_pipeline_run(run_id, status="failed", error_message=f"Weather forecast file not found: {WEATHER_FORECAST_FILE}")
            return


        bundle = joblib.load(MODEL_FILE)
        model = bundle["model"]
        feature_cols = bundle["feature_cols"]
        horizon = int(bundle.get("forecast_horizon_steps", 24))

        history_df = pd.read_csv(GLOBAL_FILE)
        history_df["timestamp"] = pd.to_datetime(history_df["timestamp"], utc=True)
        history_df = history_df.sort_values("timestamp").reset_index(drop=True)

        weather_df = pd.read_csv(WEATHER_FORECAST_FILE)
        weather_df["timestamp"] = pd.to_datetime(weather_df["timestamp"], utc=True)
        weather_df = weather_df.sort_values("timestamp").reset_index(drop=True)

        # --- NEW: Check that weather forecast covers the next 24 hours ---
        import sys
        now = pd.Timestamp.now("UTC")
        latest_weather = weather_df["timestamp"].max()
        if latest_weather < now + pd.Timedelta(hours=horizon):
            message = (
                f"Weather forecast only goes up to {latest_weather}, which is not enough for the next {horizon} hours. "
                f"Now is {now}. Please update your weather forecast file."
            )
            print(message)
            finish_pipeline_run(run_id, status="failed", error_message=message)
            sys.exit(1)

        future_weather = weather_df.head(horizon).copy()
        if len(future_weather) < horizon:
            message = f"Not enough weather forecast rows. Needed {horizon}, got {len(future_weather)}"
            print(message)
            finish_pipeline_run(run_id, status="failed", error_message=message)
            return

        working_df = history_df.copy()
        predictions = []
        generated_at = pd.Timestamp.now("UTC")

        for _, weather_row in future_weather.iterrows():
            next_ts = pd.to_datetime(weather_row["timestamp"], utc=True)

            new_row = {"timestamp": next_ts, "value": float("nan")}
            for col in weather_df.columns:
                if col != "timestamp":
                    new_row[col] = weather_row[col]

            working_df = pd.concat([working_df, pd.DataFrame([new_row])], ignore_index=True)

            feature_df = add_feature_columns(working_df.copy())
            pred_row = feature_df.iloc[-1:].copy()
            pred_row = pred_row[feature_cols]
            pred_row = pred_row.apply(pd.to_numeric, errors="coerce")

            yhat = float(model.predict(pred_row)[0])
            yhat = max(0.0, yhat)

            working_df.loc[working_df.index[-1], "value"] = yhat

            predictions.append(
                {
                    "circuit_id": "global",
                    "forecast_timestamp": next_ts,
                    "forecast_value": yhat,
                    "step_ahead": len(predictions) + 1,
                    "generated_at": generated_at,
                    "model_type": bundle.get("model_type", "unknown"),
                    "model_version": "global_best_short_hourly_model",
                    "resolution": "1h",
                }
            )

        forecast_df = pd.DataFrame(predictions)
        forecast_df.to_csv(OUTPUT_FILE, index=False)

        print(f"Saved global short-term hourly forecast -> {OUTPUT_FILE}")

        try:
            db_forecast_df = forecast_df.rename(columns={"forecast_value": "global_prediction"})[
                [
                    "forecast_timestamp",
                    "global_prediction",
                    "step_ahead",
                    "generated_at",
                    "model_version",
                    "resolution",
                ]
            ]
            write_global_forecast_to_db(db_forecast_df)
            print(f"Wrote {len(db_forecast_df)} global forecast rows to database")
        except Exception as exc:
            print(f"Database write failed for global short forecast: {exc}")

        persist_result = persist_unified_forecasts(
            forecast_df,
            scope="global",
            horizon="short",
        )
        print(f"Saved unified global short-term forecast -> {persist_result['csv_path']}")
        if persist_result["db_written"]:
            print(f"Updated database table -> {persist_result['table_name']}")

        try:
            plot_forecast_series(
                forecast_df["forecast_timestamp"],
                forecast_df["forecast_value"],
                circuit_id="global",
                horizon_type="short_hourly",
            )
        except Exception as exc:
            print(f"Forecast plotting skipped: {exc}")

        finish_pipeline_run(
            run_id,
            status="completed",
            details={"forecast_row_count": len(forecast_df), "generated_at": generated_at},
        )
    except Exception as exc:
        finish_pipeline_run(run_id, status="failed", error_message=str(exc))
        raise


if __name__ == "__main__":
    run()