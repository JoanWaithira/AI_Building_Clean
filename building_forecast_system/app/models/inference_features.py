import pandas as pd
from app.models.features import add_time_features, add_lag_features, add_rolling_features


def build_tabular_feature_row(history_df: pd.DataFrame, next_timestamp: pd.Timestamp, feature_cols: list[str]) -> pd.DataFrame:
    """
    Build one feature row for recursive tabular inference.
    """
    temp = history_df.copy()

    new_row = pd.DataFrame(
        [{"timestamp": next_timestamp, "value": temp["value"].iloc[-1]}]
    )

    temp = pd.concat([temp, new_row], ignore_index=True)

    temp["timestamp"] = pd.to_datetime(temp["timestamp"], utc=True)

    temp = add_time_features(temp)
    temp = add_lag_features(temp)
    temp = add_rolling_features(temp)

    row = temp.iloc[[-1]].copy()

    return row[feature_cols]