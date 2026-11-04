"""Synthetic demonstration: stdin JSON -> stdout JSON; diagnostics -> stderr."""
import json
import sys

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, log_loss
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler


def estimator():
    return make_pipeline(StandardScaler(), LogisticRegression(random_state=0))


def main(snapshot):
    as_of = pd.Timestamp(snapshot["asOf"])
    if as_of.tzinfo is None:
        raise ValueError("asOf must include a timezone")
    history = pd.DataFrame(snapshot["history"])
    history["observedAt"] = pd.to_datetime(history["observedAt"], utc=True)
    history["resolvedAt"] = pd.to_datetime(history["resolvedAt"], utc=True)
    if not (history["resolvedAt"] > history["observedAt"]).all():
        raise ValueError("Outcomes must resolve after feature observation")
    if not history["outcome"].isin([0, 1]).all():
        raise ValueError("outcome must be binary")
    history = history[(history["resolvedAt"] < as_of) & (history["observedAt"] < as_of)]
    history = history.sort_values("observedAt").reset_index(drop=True)
    if len(history) < 12:
        raise ValueError("Need at least 12 resolved history rows before asOf")
    # Keep equal timestamps together; purge labels unavailable at the test boundary.
    boundary = history.iloc[int(len(history) * 0.75)]["observedAt"]
    train = history[(history["observedAt"] < boundary) & (history["resolvedAt"] < boundary)]
    test = history[history["observedAt"] >= boundary]
    if train["outcome"].nunique() != 2 or test.empty:
        raise ValueError("Chronological split requires both training classes and a test set")
    features = ["signal"]  # Must be a point-in-time feature, never a final outcome proxy.
    if not np.isfinite(history[features].to_numpy(dtype=float)).all():
        raise ValueError("Non-finite history features")
    model = estimator().fit(train[features], train["outcome"])
    held_out = np.clip(model.predict_proba(test[features])[:, 1], 1e-9, 1 - 1e-9)
    metrics = {
        "trainRows": len(train), "testRows": len(test),
        "testStart": boundary.isoformat(),
        "brier": float(brier_score_loss(test["outcome"], held_out)),
        "logLoss": float(log_loss(test["outcome"], held_out, labels=[0, 1])),
        "evaluation": "chronological holdout; final forecast refit uses all eligible history",
        "dataKind": snapshot.get("dataKind", "unspecified"),
    }
    model.fit(history[features], history["outcome"])
    forecasts = []
    for market in snapshot["markets"]:
        observed_at = pd.Timestamp(market["observedAt"])
        if observed_at.tzinfo is None or observed_at > as_of:
            raise ValueError("Market features must be observed at or before asOf with timezone")
        row = pd.DataFrame([{"signal": market["signal"]}])
        if not np.isfinite(row.to_numpy(dtype=float)).all():
            raise ValueError("Non-finite market features")
        probability = float(model.predict_proba(row)[0, 1])
        forecasts.append({
            "venue": market["venue"], "marketId": market["marketId"],
            "probability": probability, "confidence": 0.0,
            "reason": "Logistic signal demonstration; confidence uncalibrated (0); no trading evidence.",
        })
    print(f"Evaluated {len(test)} chronological holdout rows", file=sys.stderr)
    return {"forecasts": forecasts, "metrics": metrics}


if __name__ == "__main__":
    print(json.dumps(main(json.load(sys.stdin)), allow_nan=False))
