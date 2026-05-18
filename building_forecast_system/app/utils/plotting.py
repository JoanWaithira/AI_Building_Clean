from pathlib import Path
import matplotlib

# Use non-GUI backend for Windows / scheduled runs
matplotlib.use("Agg")

import matplotlib.pyplot as plt
import pandas as pd


CHART_DIR = Path("artifacts/charts")
CHART_DIR.mkdir(parents=True, exist_ok=True)

MODEL_ORDER = ["baseline", "random_forest", "xgboost", "lstm", "cnn_lstm"]


def prettify_model_name(name: str) -> str:
    mapping = {
        "baseline": "Baseline",
        "random_forest": "Random Forest",
        "xgboost": "XGBoost",
        "lstm": "LSTM",
        "cnn_lstm": "CNN-LSTM",
    }
    return mapping.get(name, name)


def _prepare_circuit_df(results_df: pd.DataFrame, circuit_id: str, horizon_type: str):
    df = results_df[
        (results_df["circuit_id"] == circuit_id) &
        (results_df["horizon_type"] == horizon_type)
    ].copy()

    if df.empty:
        return df

    df["model_order"] = df["model_type"].apply(
        lambda x: MODEL_ORDER.index(x) if x in MODEL_ORDER else 999
    )
    df = df.sort_values("model_order").reset_index(drop=True)
    df["pretty_model"] = df["model_type"].apply(prettify_model_name)

    return df


def _bar_colors(df: pd.DataFrame, selection_metric: str):
    best_idx = df[selection_metric].idxmin()

    colors = []
    edgecolors = []
    linewidths = []

    for idx in df.index:
        if idx == best_idx:
            colors.append("gold")
            edgecolors.append("red")
            linewidths.append(2.0)
        else:
            colors.append("steelblue")
            edgecolors.append("black")
            linewidths.append(0.8)

    return colors, edgecolors, linewidths, best_idx


def _annotate_bars(ax, bars, values, fmt="{:.1f}", color="black"):
    for bar, val in zip(bars, values):
        ax.text(
            bar.get_x() + bar.get_width() / 2,
            bar.get_height(),
            fmt.format(val),
            ha="center",
            va="bottom",
            fontsize=9,
            color=color,
        )


def plot_model_comparison_for_circuit(results_df: pd.DataFrame, circuit_id: str, horizon_type: str = "short"):
    df = _prepare_circuit_df(results_df, circuit_id, horizon_type)

    if df.empty:
        return

    colors, edgecolors, linewidths, _ = _bar_colors(df, selection_metric="val_rmse")

    plt.figure(figsize=(9, 5))
    bars = plt.bar(
        df["pretty_model"],
        df["test_rmse"],
        color=colors,
        edgecolor=edgecolors,
        linewidth=linewidths,
    )
    _annotate_bars(plt.gca(), bars, df["test_rmse"])

    plt.title(f"{circuit_id} - {horizon_type} model comparison (Test RMSE)")
    plt.xlabel("Model")
    plt.ylabel("RMSE")
    plt.xticks(rotation=15)
    plt.tight_layout()

    output_file = CHART_DIR / f"{circuit_id}_{horizon_type}_rmse.png"
    plt.savefig(output_file, dpi=150, bbox_inches="tight")
    plt.close()


def plot_complete_model_performance_for_circuit(results_df: pd.DataFrame, circuit_id: str, horizon_type: str = "short"):
    df = _prepare_circuit_df(results_df, circuit_id, horizon_type)

    if df.empty:
        return

    selection_metric = "val_rmse"
    colors, edgecolors, linewidths, best_idx = _bar_colors(df, selection_metric=selection_metric)
    best_model_name = df.loc[best_idx, "pretty_model"]

    fig, axes = plt.subplots(2, 2, figsize=(14, 9))
    axes = axes.flatten()

    panels = [
        ("val_mae", "Val MAE Comparison"),
        ("val_rmse", "Val RMSE Comparison (Selection Criterion)"),
        ("test_mae", "Test MAE Comparison"),
        ("test_rmse", "Test RMSE Comparison"),
    ]

    for ax, (metric_col, title) in zip(axes, panels):
        bars = ax.bar(
            df["pretty_model"],
            df[metric_col],
            color=colors,
            edgecolor=edgecolors,
            linewidth=linewidths,
        )
        _annotate_bars(ax, bars, df[metric_col])

        ax.set_title(title, fontsize=11, fontweight="bold")
        ax.set_ylabel(metric_col.replace("_", " ").upper())
        ax.tick_params(axis="x", rotation=15)

    fig.suptitle(
        f"Complete Model Performance Comparison - {circuit_id} ({horizon_type})\n"
        f"Selected best model: {best_model_name} by lowest Validation RMSE",
        fontsize=14,
        fontweight="bold",
    )

    plt.tight_layout(rect=[0, 0, 1, 0.94])

    output_file = CHART_DIR / f"{circuit_id}_{horizon_type}_complete_comparison.png"
    plt.savefig(output_file, dpi=150, bbox_inches="tight")
    plt.close()


def plot_best_model_counts(results_df: pd.DataFrame, horizon_type: str = "short"):
    df = results_df[results_df["horizon_type"] == horizon_type].copy()

    if df.empty:
        return

    winners = df[df["is_best"] == True]
    counts = winners["model_type"].value_counts()

    if counts.empty:
        return

    pretty_index = [prettify_model_name(x) for x in counts.index]

    plt.figure(figsize=(8, 5))
    bars = plt.bar(pretty_index, counts.values, color="steelblue", edgecolor="black")
    _annotate_bars(plt.gca(), bars, counts.values, fmt="{:.0f}")

    plt.title(f"Best model counts across circuits ({horizon_type})")
    plt.xlabel("Model")
    plt.ylabel("Number of winning circuits")
    plt.xticks(rotation=15)
    plt.tight_layout()

    output_file = CHART_DIR / f"best_model_counts_{horizon_type}.png"
    plt.savefig(output_file, dpi=150, bbox_inches="tight")
    plt.close()


def plot_actual_vs_predicted(timestamps, y_true, y_pred, circuit_id: str, horizon_type: str = "short"):
    plt.figure(figsize=(10, 5))
    plt.plot(timestamps, y_true, label="Actual")
    plt.plot(timestamps, y_pred, label="Predicted")
    plt.title(f"{circuit_id} - {horizon_type} actual vs predicted")
    plt.xlabel("Time")
    plt.ylabel("Value")
    plt.legend()
    plt.tight_layout()

    output_file = CHART_DIR / f"{circuit_id}_{horizon_type}_actual_vs_pred.png"
    plt.savefig(output_file, dpi=150, bbox_inches="tight")
    plt.close()


def plot_inference_forecast(history_df: pd.DataFrame, forecast_df: pd.DataFrame, circuit_id: str, horizon_type: str = "short"):
    if history_df.empty or forecast_df.empty:
        return

    plt.figure(figsize=(12, 5))

    plt.plot(
        history_df["timestamp"],
        history_df["value"],
        label="Recent History",
    )

    plt.plot(
        forecast_df["forecast_timestamp"],
        forecast_df["forecast_value"],
        label="Forecast",
    )

    plt.title(f"{circuit_id} - {horizon_type} forecast")
    plt.xlabel("Time")
    plt.ylabel("Value")
    plt.legend()
    plt.tight_layout()

    output_file = CHART_DIR / f"{circuit_id}_{horizon_type}_forecast.png"
    plt.savefig(output_file, dpi=150, bbox_inches="tight")
    plt.close()


def plot_forecast_series(timestamps, values, circuit_id: str, horizon_type: str = "short"):
    """
    Compatibility plotting helper used by inference pipelines.
    Accepts timestamp/value arrays and stores a single-series forecast chart.
    """
    if timestamps is None or values is None:
        return

    ts = pd.to_datetime(timestamps, utc=True)
    series = pd.Series(values)

    if len(ts) == 0 or len(series) == 0:
        return

    plt.figure(figsize=(10, 5))
    plt.plot(ts, series, label="Forecast")
    plt.title(f"{circuit_id} - {horizon_type} forecast")
    plt.xlabel("Time")
    plt.ylabel("Forecast Value")
    plt.legend()
    plt.tight_layout()

    output_file = CHART_DIR / f"{circuit_id}_{horizon_type}_forecast_series.png"
    plt.savefig(output_file, dpi=150, bbox_inches="tight")
    plt.close()