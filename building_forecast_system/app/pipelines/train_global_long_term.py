from pathlib import Path
import joblib
import numpy as np
import pandas as pd

from app.pipelines.global_features_hourly import build_global_long_term_hourly_dataset
from app.models.candidate_models import build_candidate_models, evaluate_regression
from app.utils.plotting import (
    plot_model_comparison_for_circuit,
    plot_complete_model_performance_for_circuit,
    plot_best_model_counts,
    plot_actual_vs_predicted,
)

PROCESSED_DIR = Path("data/processed")
METRICS_DIR = Path("data/metrics")
MODEL_DIR = Path("artifacts/models/global")

METRICS_DIR.mkdir(parents=True, exist_ok=True)
MODEL_DIR.mkdir(parents=True, exist_ok=True)

GLOBAL_FILE = PROCESSED_DIR / "global_hourly_clean.csv"


def chronological_split(df: pd.DataFrame):
    n = len(df)

    train_end = int(n * 0.8)
    val_end = int(n * 0.9)

    train_df = df.iloc[:train_end].copy()
    val_df = df.iloc[train_end:val_end].copy()
    test_df = df.iloc[val_end:].copy()

    return train_df, val_df, test_df


def fit_with_recent_weights(
    model,
    X_train: pd.DataFrame,
    y_train: pd.Series,
    X_val: pd.DataFrame | None = None,
    y_val: pd.Series | None = None,
):
    # Slightly favor recent observations to improve near-future accuracy.
    sample_weight = np.linspace(1.0, 2.0, len(X_train), dtype=float)

    model_name = model.__class__.__name__.lower()
    has_validation = X_val is not None and y_val is not None and len(X_val) > 0

    try:
        if "xgb" in model_name and has_validation:
            model.fit(
                X_train,
                y_train,
                sample_weight=sample_weight,
                eval_set=[(X_val, y_val)],
                verbose=False,
            )
        else:
            model.fit(X_train, y_train, sample_weight=sample_weight)
    except TypeError:
        if "xgb" in model_name and has_validation:
            model.fit(
                X_train,
                y_train,
                eval_set=[(X_val, y_val)],
                verbose=False,
            )
        else:
            model.fit(X_train, y_train)


def run():
    if not GLOBAL_FILE.exists():
        print("global_hourly_clean.csv not found. Run build_global_series first.")
        return

    print("Training global long-term hourly models")

    df = pd.read_csv(GLOBAL_FILE)
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)

    dataset, feature_cols = build_global_long_term_hourly_dataset(df)

    if len(dataset) < 200:
        print("Global dataset is too small after feature engineering.")
        return

    train_df, val_df, test_df = chronological_split(dataset)

    X_train = train_df[feature_cols]
    y_train = train_df["target"]

    X_val = val_df[feature_cols]
    y_val = val_df["target"]

    X_test = test_df[feature_cols]
    y_test = test_df["target"]

    candidate_models = build_candidate_models()

    results = []

    best_model_name = None
    best_val_rmse = float("inf")
    best_model_bundle = None
    best_test_pred = None

    circuit_id = "global"

    for model_name, model in candidate_models.items():
        print(f"Training global long-term hourly model: {model_name}")

        fit_with_recent_weights(model, X_train, y_train, X_val, y_val)

        val_pred = model.predict(X_val)
        test_pred = model.predict(X_test)

        val_metrics = evaluate_regression(y_val, val_pred)
        test_metrics = evaluate_regression(y_test, test_pred)

        result = {
            "circuit_id": circuit_id,
            "horizon_type": "long_hourly",
            "model_type": model_name,
            "val_rmse": val_metrics["rmse"],
            "val_mae": val_metrics["mae"],
            "test_rmse": test_metrics["rmse"],
            "test_mae": test_metrics["mae"],
            "is_best": False,
        }

        results.append(result)

        if val_metrics["rmse"] < best_val_rmse:
            best_val_rmse = val_metrics["rmse"]
            best_model_name = model_name
            best_test_pred = test_pred

            best_model_bundle = {
                "model": model,
                "feature_cols": feature_cols,
                "circuit_id": "global",
                "horizon_type": "long_hourly",
                "model_type": model_name,
                "model_family": "tabular",
                "resolution": "1h",
                "forecast_horizon_steps": 48,
            }

    for r in results:
        if r["model_type"] == best_model_name:
            r["is_best"] = True

    if best_model_bundle is not None:
        model_file = MODEL_DIR / "global_best_long_hourly_model.joblib"
        joblib.dump(best_model_bundle, model_file)

        print(f"Saved global best long-term model: {model_file}")

        try:
            plot_actual_vs_predicted(
                timestamps=test_df["timestamp"],
                y_true=y_test,
                y_pred=best_test_pred,
                circuit_id="global",
                horizon_type="long_hourly",
            )
        except Exception as exc:
            print(f"Actual-vs-predicted plotting skipped: {exc}")

    results_df = pd.DataFrame(results)

    metrics_file = METRICS_DIR / "global_long_hourly_results.csv"
    results_df.to_csv(metrics_file, index=False)

    print(f"Saved global long-term metrics: {metrics_file}")

    try:
        plot_model_comparison_for_circuit(
            results_df,
            circuit_id="global",
            horizon_type="long_hourly",
        )
    except Exception as exc:
        print(f"Model comparison plotting skipped: {exc}")

    try:
        plot_complete_model_performance_for_circuit(
            results_df,
            circuit_id="global",
            horizon_type="long_hourly",
        )
    except Exception as exc:
        print(f"Complete performance plotting skipped: {exc}")

    try:
        plot_best_model_counts(results_df, horizon_type="long_hourly")
    except Exception as exc:
        print(f"Best-model-count plotting skipped: {exc}")

    print("Finished global long-term hourly training")


if __name__ == "__main__":
    run()
