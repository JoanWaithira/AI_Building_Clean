from pathlib import Path
import joblib
import pandas as pd

from app.models.long_term_features import build_long_term_dataset
from app.models.sequence_features import (
    build_long_sequence_dataset,
    LONG_SEQUENCE_FEATURE_COLS,
    LONG_LOOKBACK,
)
from app.models.candidate_models import build_candidate_models, evaluate_regression
from app.models.train_deep_models import (
    train_lstm,
    train_cnn_lstm,
    split_sequence_data,
)
from app.pipelines.training_utils import (
    chronological_split,
    fit_with_recent_weights,
)
from app.utils.plotting import (
    plot_model_comparison_for_circuit,
    plot_complete_model_performance_for_circuit,
    plot_best_model_counts,
    plot_actual_vs_predicted,
)


PROCESSED_DIR = Path("data/processed")
METRICS_DIR = Path("data/metrics")
MODEL_DIR = Path("artifacts/models/long_term")

METRICS_DIR.mkdir(parents=True, exist_ok=True)
MODEL_DIR.mkdir(parents=True, exist_ok=True)


def train_one_circuit(file_path: Path) -> list[dict]:
    circuit_id = file_path.name.replace("_clean.csv", "")
    print(f"\nTraining long-term circuit: {circuit_id}")

    df = pd.read_csv(file_path)

    if df.empty or len(df) < 1000:
        print(f"Skipping {circuit_id}: not enough raw cleaned data")
        return []

    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)

    dataset, feature_cols = build_long_term_dataset(df)

    if len(dataset) < 300:
        print(f"Skipping {circuit_id}: long-term dataset too small")
        return []

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
    train_df, val_df, test_df = chronological_split(dataset)

    X_train = train_df[feature_cols]
    y_train = train_df["target"]

    X_val = val_df[feature_cols]
    y_val = val_df["target"]

    X_test = test_df[feature_cols]
    y_test = test_df["target"]

    candidate_models = build_candidate_models()

    for model_name, model in candidate_models.items():
        print(f"  Training long-term tabular model: {model_name}")

        fit_with_recent_weights(model, X_train, y_train, X_val, y_val)

        val_pred = model.predict(X_val)
        test_pred = model.predict(X_test)

        val_metrics = evaluate_regression(y_val, val_pred)
        test_metrics = evaluate_regression(y_test, test_pred)

        result = {
            "circuit_id": circuit_id,
            "horizon_type": "long",
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
                "horizon_type": "long",
                "model_type": model_name,
                "model_family": "tabular",
                "resolution": "1h",
            }

    # =========================================================
    # 2. DEEP MODELS (LSTM and CNN-LSTM)
    # =========================================================
    # Operates on hourly-resampled data with a 1-week lookback window.
    # Uses long-term specific features: adds month_sin/cos for seasonal
    # awareness — absent from short-term sequences.
    hourly_df = dataset[["timestamp", "value"]].copy()

    seq_X, seq_y = build_long_sequence_dataset(
        df=hourly_df,
        target_col="value",
        lookback=LONG_LOOKBACK,
    )
    n_long_sequence_features = len(LONG_SEQUENCE_FEATURE_COLS)

    if len(seq_X) >= 300:
        X_train_seq, y_train_seq, X_val_seq, y_val_seq, X_test_seq, y_test_seq = split_sequence_data(seq_X, seq_y)

        seq_timestamps = hourly_df["timestamp"].iloc[LONG_LOOKBACK:].reset_index(drop=True)
        n_seq = len(seq_timestamps)
        val_end = int(n_seq * 0.9)
        test_seq_timestamps = seq_timestamps.iloc[val_end:].reset_index(drop=True)

        # LSTM — use more epochs since hourly dataset is smaller than 5-min
        print("  Training long-term deep model: lstm")
        lstm_model, lstm_val_metrics, lstm_test_metrics, lstm_test_pred = train_lstm(
            X_train_seq, y_train_seq,
            X_val_seq, y_val_seq,
            X_test_seq, y_test_seq,
            epochs=50,
        )

        results.append({
            "circuit_id": circuit_id,
            "horizon_type": "long",
            "model_type": "lstm",
            "val_rmse": lstm_val_metrics["rmse"],
            "val_mae": lstm_val_metrics["mae"],
            "test_rmse": lstm_test_metrics["rmse"],
            "test_mae": lstm_test_metrics["mae"],
            "is_best": False,
        })

        if lstm_val_metrics["rmse"] < best_val_rmse:
            best_val_rmse = lstm_val_metrics["rmse"]
            best_model_name = "lstm"
            best_test_pred = lstm_test_pred
            best_test_timestamps = test_seq_timestamps
            best_model_save_type = "keras"
            best_model_bundle = {
                "model": lstm_model,
                "lookback": LONG_LOOKBACK,
                "n_sequence_features": n_long_sequence_features,
                "circuit_id": circuit_id,
                "horizon_type": "long",
                "model_type": "lstm",
                "model_family": "deep",
                "resolution": "1h",
            }

        # CNN-LSTM
        print("  Training long-term deep model: cnn_lstm")
        cnn_lstm_model, cnn_lstm_val_metrics, cnn_lstm_test_metrics, cnn_lstm_test_pred = train_cnn_lstm(
            X_train_seq, y_train_seq,
            X_val_seq, y_val_seq,
            X_test_seq, y_test_seq,
            epochs=50,
        )

        results.append({
            "circuit_id": circuit_id,
            "horizon_type": "long",
            "model_type": "cnn_lstm",
            "val_rmse": cnn_lstm_val_metrics["rmse"],
            "val_mae": cnn_lstm_val_metrics["mae"],
            "test_rmse": cnn_lstm_test_metrics["rmse"],
            "test_mae": cnn_lstm_test_metrics["mae"],
            "is_best": False,
        })

        if cnn_lstm_val_metrics["rmse"] < best_val_rmse:
            best_val_rmse = cnn_lstm_val_metrics["rmse"]
            best_model_name = "cnn_lstm"
            best_test_pred = cnn_lstm_test_pred
            best_test_timestamps = test_seq_timestamps
            best_model_save_type = "keras"
            best_model_bundle = {
                "model": cnn_lstm_model,
                "lookback": LONG_LOOKBACK,
                "n_sequence_features": n_long_sequence_features,
                "circuit_id": circuit_id,
                "horizon_type": "long",
                "model_type": "cnn_lstm",
                "model_family": "deep",
                "resolution": "1h",
            }
    else:
        print(f"  Skipping deep models for {circuit_id}: long sequence dataset too small ({len(seq_X)} samples, need >= 300)")

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
            model_file = MODEL_DIR / f"{circuit_id}_best_long_model.joblib"
            joblib.dump(best_model_bundle, model_file)
            print(f"  Saved best long-term tabular model: {model_file}")
            # Remove stale deep-model files so inference doesn't pick them up.
            for stale in [
                MODEL_DIR / f"{circuit_id}_best_long_model.keras",
                MODEL_DIR / f"{circuit_id}_best_long_model_metadata.joblib",
            ]:
                if stale.exists():
                    stale.unlink()
                    print(f"  Removed stale model file: {stale.name}")

        elif best_model_save_type == "keras":
            model_file = MODEL_DIR / f"{circuit_id}_best_long_model.keras"
            best_model_bundle["model"].save(model_file)
            metadata_file = MODEL_DIR / f"{circuit_id}_best_long_model_metadata.joblib"
            metadata = {
                "lookback": best_model_bundle["lookback"],
                "n_sequence_features": best_model_bundle["n_sequence_features"],
                "circuit_id": best_model_bundle["circuit_id"],
                "horizon_type": best_model_bundle["horizon_type"],
                "model_type": best_model_bundle["model_type"],
                "model_family": best_model_bundle["model_family"],
                "resolution": best_model_bundle["resolution"],
            }
            joblib.dump(metadata, metadata_file)
            print(f"  Saved best long-term deep model: {model_file}")
            print(f"  Saved deep model metadata: {metadata_file}")
            # Remove stale tabular file so inference doesn't pick it up instead.
            stale_joblib = MODEL_DIR / f"{circuit_id}_best_long_model.joblib"
            if stale_joblib.exists():
                stale_joblib.unlink()
                print(f"  Removed stale model file: {stale_joblib.name}")

        if best_test_pred is not None and best_test_timestamps is not None:
            y_true_plot = y_test if best_model_save_type == "joblib" else y_test_seq
            plot_actual_vs_predicted(
                timestamps=best_test_timestamps,
                y_true=y_true_plot,
                y_pred=best_test_pred,
                circuit_id=circuit_id,
                horizon_type="long",
            )

    return results


def run():
    files = [
        file
        for file in PROCESSED_DIR.glob("*_clean.csv")
        if file.name not in {"global_clean.csv", "global_hourly_clean.csv"}
    ]

    if not files:
        print("No cleaned circuit files found in data/processed")
        return

    print(f"Found {len(files)} cleaned circuit files for long-term training")

    all_results = []

    for file_path in files:
        circuit_results = train_one_circuit(file_path)
        all_results.extend(circuit_results)

    if not all_results:
        print("No long-term training results produced")
        return

    results_df = pd.DataFrame(all_results)

    metrics_file = METRICS_DIR / "long_term_model_results.csv"
    results_df.to_csv(metrics_file, index=False)
    print(f"\nSaved long-term metrics: {metrics_file}")

    for circuit_id in results_df["circuit_id"].unique():
        plot_model_comparison_for_circuit(
            results_df=results_df,
            circuit_id=circuit_id,
            horizon_type="long",
        )

        plot_complete_model_performance_for_circuit(
            results_df=results_df,
            circuit_id=circuit_id,
            horizon_type="long",
        )

    plot_best_model_counts(results_df, horizon_type="long")

    print("Finished long-term training pipeline")


if __name__ == "__main__":
    run()
