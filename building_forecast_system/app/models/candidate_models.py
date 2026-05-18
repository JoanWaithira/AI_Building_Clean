import numpy as np
from sklearn.ensemble import ExtraTreesRegressor, RandomForestRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error
from xgboost import XGBRegressor


class PersistenceBaseline:
    """
    Simple baseline:
    predict next value = lag_1
    """
    name = "baseline"

    def fit(self, X, y):
        return self

    def predict(self, X):
        if "lag_1" not in X.columns:
            raise ValueError("lag_1 feature is required for PersistenceBaseline")
        return X["lag_1"].values


def build_candidate_models():
    return {
        "baseline": PersistenceBaseline(),
        "random_forest": RandomForestRegressor(
            n_estimators=200,
            max_depth=16,
            min_samples_leaf=2,
            max_features="sqrt",
            bootstrap=True,
            random_state=42,
            n_jobs=-1,
        ),
        "extra_trees": ExtraTreesRegressor(
            n_estimators=200,
            max_depth=18,
            min_samples_leaf=2,
            max_features="sqrt",
            random_state=42,
            n_jobs=-1,
        ),
        "xgboost": XGBRegressor(
            n_estimators=600,
            max_depth=8,
            learning_rate=0.03,
            subsample=0.85,
            colsample_bytree=0.85,
            reg_alpha=0.1,
            reg_lambda=2.0,
            objective="reg:squarederror",
            early_stopping_rounds=50,
            random_state=42,
            n_jobs=4,
        ),
    }


def evaluate_regression(y_true, y_pred) -> dict:
    rmse = float(np.sqrt(mean_squared_error(y_true, y_pred)))
    mae = float(mean_absolute_error(y_true, y_pred))
    return {
        "rmse": rmse,
        "mae": mae,
    }