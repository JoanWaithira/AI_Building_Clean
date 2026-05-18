from pathlib import Path
from concurrent.futures import ProcessPoolExecutor, as_completed
import os

import joblib
import pandas as pd

from app.models.features import build_short_term_dataset
from app.models.sequence_features import build_sequence_dataset, SEQUENCE_FEATURE_COLS
from app.models.candidate_models import build_candidate_models, evaluate_regression
from app.models.plotting import (
    plot_model_comparison_for_circuit,
    plot_best_model_counts,
    plot_actual_vs_predicted,
)
from app.models.train_deep_models import (
    train_lstm,
    train_cnn_lstm,
    split_sequence_data,
)
from app.pipelines.training_utils import (
    chronological_split,
    fit_with_recent_weights,
)


PROCESSED_DIR = Path("data/processed")
METRICS_DIR = Path("data/metrics")
MODEL_DIR = Path("artifacts/models/short_term")

# Optional local-test controls.
# Normal production behavior is unchanged when these env vars are not set.
TRAIN_ONLY_CIRCUIT = os.getenv("TRAIN_ONLY_CIRCUIT", "").strip().lower()
SKIP_DEEP_MODELS = os.getenv("SKIP_DEEP_MODELS", "false").strip().lower() in {
    "1",
    "true",
    "yes",
}
TRAIN_MAX_WORKERS = os.getenv("TRAIN_MAX_WORKERS")

METRICS_DIR.mkdir(parents=True, exist_ok=True)
MODEL_DIR.mkdir(parents=True, exist_ok=True)


def train_one_circuit(file_path: Path) -> list[dict]:
    circuit_id = file_path.name.replace("_clean.csv", "")
    print(f"\nTraining circuit: {circuit_id}", flush=True)

    df = pd.read_csv(file_path)

    if df.empty or len(df) < 1000:
        print(f"Skipping {circuit_id}: not enough data", flush=True)
        return []

    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)

    results = []
    best_model_name = None
    best_val_rmse = float("inf")
    best_model_bundle = None
    best_test_pred = None
    best_test_timestamps = None
    best_model_save_type = None

    # =========================================================
    # 1. TABULAR MODELS
    # =========================================================
    dataset, feature_cols = build_short_term_dataset(df)

    if len(dataset) < 1000:
        print(
            f"Skipping {circuit_id}: dataset too small after feature engineering",
            flush=True,
        )
        return []

    train_df, val_df, test_df = chronological_split(dataset)

    X_train = train_df[feature_cols]
    y_train = train_df["target"]

    X_val = val_df[feature_cols]
    y_val = val_df["target"]

    X_test = test_df[feature_cols]
    y_test = test_df["target"]

    candidate_models = build_candidate_models()

    for model_name, model in candidate_models.items():
        print(f"  Training tabular model: {model_name}", flush=True)

        fit_with_recent_weights(model, X_train, y_train, X_val, y_val)

        val_pred = model.predict(X_val)
        test_pred = model.predict(X_test)

        val_metrics = evaluate_regression(y_val, val_pred)
        test_metrics = evaluate_regression(y_test, test_pred)

        result = {
            "circuit_id": circuit_id,
            "horizon_type": "short",
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
            best_test_timestamps = test_df["timestamp"]
            best_model_save_type = "joblib"
            best_model_bundle = {
                "model": model,
                "feature_cols": feature_cols,
                "circuit_id": circuit_id,
                "horizon_type": "short",
                "model_type": model_name,
                "model_family": "tabular",
            }

    # =========================================================
    # 2. DEEP MODELS (LSTM and CNN-LSTM)
    # =========================================================
    if SKIP_DEEP_MODELS:
        print(
            f"  Skipping deep models for {circuit_id}: SKIP_DEEP_MODELS=true",
            flush=True,
        )
    else:
        # lookback=96 → 8-hour window at 5-min resolution.
        # Sequences are multivariate: value + cyclic time features.
        lookback = 96

        seq_X, seq_y = build_sequence_dataset(
            df=df,
            target_col="value",
            lookback=lookback,
            horizon=1,
        )
        n_sequence_features = len(SEQUENCE_FEATURE_COLS)

        if len(seq_X) >= 500:
            (
                X_train_seq,
                y_train_seq,
                X_val_seq,
                y_val_seq,
                X_test_seq,
                y_test_seq,
            ) = split_sequence_data(seq_X, seq_y)

            # Approximate timestamps for sequence test set.
            seq_timestamps = df["timestamp"].iloc[lookback:].reset_index(drop=True)
            n_seq = len(seq_timestamps)
            val_end = int(n_seq * 0.9)
            test_seq_timestamps = seq_timestamps.iloc[val_end:].reset_index(drop=True)

            # LSTM
            print("  Training deep model: lstm", flush=True)
            lstm_model, lstm_val_metrics, lstm_test_metrics, lstm_test_pred = (
                train_lstm(
                    X_train_seq,
                    y_train_seq,
                    X_val_seq,
                    y_val_seq,
                    X_test_seq,
                    y_test_seq,
                )
            )

            results.append(
                {
                    "circuit_id": circuit_id,
                    "horizon_type": "short",
                    "model_type": "lstm",
                    "val_rmse": lstm_val_metrics["rmse"],
                    "val_mae": lstm_val_metrics["mae"],
                    "test_rmse": lstm_test_metrics["rmse"],
                    "test_mae": lstm_test_metrics["mae"],
                    "is_best": False,
                }
            )

            if lstm_val_metrics["rmse"] < best_val_rmse:
                best_val_rmse = lstm_val_metrics["rmse"]
                best_model_name = "lstm"
                best_test_pred = lstm_test_pred
                best_test_timestamps = test_seq_timestamps
                best_model_save_type = "keras"
                best_model_bundle = {
                    "model": lstm_model,
                    "lookback": lookback,
                    "n_sequence_features": n_sequence_features,
                    "circuit_id": circuit_id,
                    "horizon_type": "short",
                    "model_type": "lstm",
                    "model_family": "deep",
                }

            # CNN-LSTM
            print("  Training deep model: cnn_lstm", flush=True)
            (
                cnn_lstm_model,
                cnn_lstm_val_metrics,
                cnn_lstm_test_metrics,
                cnn_lstm_test_pred,
            ) = train_cnn_lstm(
                X_train_seq,
                y_train_seq,
                X_val_seq,
                y_val_seq,
                X_test_seq,
                y_test_seq,
            )

            results.append(
                {
                    "circuit_id": circuit_id,
                    "horizon_type": "short",
                    "model_type": "cnn_lstm",
                    "val_rmse": cnn_lstm_val_metrics["rmse"],
                    "val_mae": cnn_lstm_val_metrics["mae"],
                    "test_rmse": cnn_lstm_test_metrics["rmse"],
                    "test_mae": cnn_lstm_test_metrics["mae"],
                    "is_best": False,
                }
            )

            if cnn_lstm_val_metrics["rmse"] < best_val_rmse:
                best_val_rmse = cnn_lstm_val_metrics["rmse"]
                best_model_name = "cnn_lstm"
                best_test_pred = cnn_lstm_test_pred
                best_test_timestamps = test_seq_timestamps
                best_model_save_type = "keras"
                best_model_bundle = {
                    "model": cnn_lstm_model,
                    "lookback": lookback,
                    "n_sequence_features": n_sequence_features,
                    "circuit_id": circuit_id,
                    "horizon_type": "short",
                    "model_type": "cnn_lstm",
                    "model_family": "deep",
                }
        else:
            print(
                f"  Skipping deep models for {circuit_id}: sequence dataset too small",
                flush=True,
            )

    # =========================================================
    # 3. MARK BEST MODEL
    # =========================================================
    for r in results:
        if r["model_type"] == best_model_name:
            r["is_best"] = True

    # =========================================================
    # 4. SAVE BEST MODEL
    # =========================================================
    if best_model_bundle is not None:
        if best_model_save_type == "joblib":
            model_file = MODEL_DIR / f"{circuit_id}_best_short_model.joblib"
            joblib.dump(best_model_bundle, model_file)
            print(f"  Saved best tabular model: {model_file}", flush=True)

            # Remove stale deep-model files so inference does not pick them up.
            for stale in [
                MODEL_DIR / f"{circuit_id}_best_short_model.keras",
                MODEL_DIR / f"{circuit_id}_best_short_model_metadata.joblib",
            ]:
                if stale.exists():
                    stale.unlink()
                    print(f"  Removed stale model file: {stale.name}", flush=True)

        elif best_model_save_type == "keras":
            model_file = MODEL_DIR / f"{circuit_id}_best_short_model.keras"
            best_model_bundle["model"].save(model_file)

            metadata_file = MODEL_DIR / f"{circuit_id}_best_short_model_metadata.joblib"

            # Remove stale tabular file so inference does not pick it up instead.
            stale_joblib = MODEL_DIR / f"{circuit_id}_best_short_model.joblib"
            if stale_joblib.exists():
                stale_joblib.unlink()
                print(f"  Removed stale model file: {stale_joblib.name}", flush=True)

            metadata = {
                "lookback": best_model_bundle["lookback"],
                "n_sequence_features": best_model_bundle["n_sequence_features"],
                "circuit_id": best_model_bundle["circuit_id"],
                "horizon_type": best_model_bundle["horizon_type"],
                "model_type": best_model_bundle["model_type"],
                "model_family": best_model_bundle["model_family"],
            }
            joblib.dump(metadata, metadata_file)

            print(f"  Saved best deep model: {model_file}", flush=True)
            print(f"  Saved deep model metadata: {metadata_file}", flush=True)

        if best_test_pred is not None and best_test_timestamps is not None:
            # Pick correct y_true based on best model family.
            if best_model_save_type == "joblib":
                y_true_plot = y_test
            else:
                y_true_plot = y_test_seq

            plot_actual_vs_predicted(
                timestamps=best_test_timestamps,
                y_true=y_true_plot,
                y_pred=best_test_pred,
                circuit_id=circuit_id,
                horizon_type="short",
            )

    return results


def run(max_workers: int | None = None):
    files = [
        file
        for file in PROCESSED_DIR.glob("*_clean.csv")
        if file.name not in {"global_clean.csv", "global_hourly_clean.csv"}
    ]

    if TRAIN_ONLY_CIRCUIT:
        files = [
            file
            for file in files
            if file.name.replace("_clean.csv", "").lower() == TRAIN_ONLY_CIRCUIT
        ]
        print(f"TRAIN_ONLY_CIRCUIT={TRAIN_ONLY_CIRCUIT}", flush=True)

    if not files:
        print("No cleaned circuit files found in data/processed", flush=True)
        return

    print(f"Found {len(files)} cleaned circuit files", flush=True)

    if TRAIN_MAX_WORKERS:
        n_workers = int(TRAIN_MAX_WORKERS)
    else:
        n_workers = max_workers or max(1, (os.cpu_count() or 1) - 1)

    print(f"Training in parallel with {n_workers} workers", flush=True)

    all_results = []

    with ProcessPoolExecutor(max_workers=n_workers) as executor:
        futures = {executor.submit(train_one_circuit, f): f for f in files}

        for future in as_completed(futures):
            file_path = futures[future]
            try:
                circuit_results = future.result()
                all_results.extend(circuit_results)
            except Exception as exc:
                print(f"  ERROR training {file_path.name}: {exc}", flush=True)

    if not all_results:
        print("No training results produced", flush=True)
        return

    results_df = pd.DataFrame(all_results)

    metrics_file = METRICS_DIR / "short_term_model_results.csv"
    results_df.to_csv(metrics_file, index=False)
    print(f"\nSaved metrics: {metrics_file}", flush=True)

    for circuit_id in results_df["circuit_id"].unique():
        plot_model_comparison_for_circuit(
            results_df=results_df,
            circuit_id=circuit_id,
            horizon_type="short",
        )

    plot_best_model_counts(results_df, horizon_type="short")

    print("Finished short-term training pipeline", flush=True)


if __name__ == "__main__":
    run()
