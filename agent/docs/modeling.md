# Python forecast models

`src/models.ts` exports `runModel`, `modelOutputSchema`, `ModelOutput`, and
`modelWorkspace`. Models return forecasts; these outputs are **not permission to
trade**. Order approval, risk limits, exchange access, and scheduling belong to
other layers. This workflow does not place orders or schedule execution.

## Setup and first run

Use Python 3.11 or newer with compatible wheels for the bounded dependencies:

```sh
cd agent
python3 -m venv .venv
.venv/bin/pip install -r python/requirements.txt
.venv/bin/python python/examples/logistic.py < python/fixtures/snapshot.json
bun test tests/models.test.ts
bunx tsc --noEmit
```

`numpy>=2.3,<3`, `pandas>=2.3,<4`, and `scikit-learn>=1.7,<2` are bounded compatibility
ranges, not a reproducible lock. Save `pip freeze`, Python version, platform,
source, and snapshot alongside each evaluation when comparing versions. The
fixture is entirely synthetic and only proves the plumbing works. Its metrics
are not evidence of forecasting skill or profitability.

The runner defaults to the absolute `agent/.venv/bin/python` path. Tests use
`python3` (override with `TEST_PYTHON`) and only the Python standard library;
pandas is not required to run the TypeScript tests.

## Creating and editing a strategy model

1. Copy `python/examples/logistic.py` to `state/models/my-strategy/model.py`
   after creating that directory, or author Python source directly.
2. Edit that file in response to the user's strategy specification. Tracked
   examples are templates; working models belong under ignored `agent/state/models/`.
3. Read its source and pass an explicit point-in-time JSON snapshot to `runModel`.
4. Inspect the validated forecasts and held-out evaluation before considering any
   downstream action. Save the exact source and input with the returned hash in
   your evaluation record. Changing source changes the hash.

```ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { modelWorkspace, runModel } from "./src/models";

const strategyId = "my-strategy";
const source = await readFile(join(modelWorkspace, strategyId, "model.py"), "utf8");
const snapshot = JSON.parse(await readFile("python/fixtures/snapshot.json", "utf8"));
const { version, output } = await runModel(strategyId, source, snapshot);
// Optional: { python: "/absolute/path/to/python", timeoutMs: 60_000 }
```

Interface:

```ts
runModel(
  strategyId: string,
  source: string,
  input: unknown,
  options?: { python?: string; timeoutMs?: number },
): Promise<{ version: string; output: ModelOutput }>
```

The ID must match `[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}`. The runner rejects symlinked
workspace ancestors. Each invocation writes the latest editable `model.py` via
an atomic rename and executes a unique temporary copy so concurrent executions
cannot substitute another invocation's source. Temporary copies are removed
on completion or failure. Failed runs still update the editable source. Serialize
calls for a strategy if the order of edits matters. The 64-character lowercase
`version` is SHA-256 of the exact UTF-8 source bytes, not dependencies or input;
it does not identify a fitted artifact or make results reproducible by itself.

## JSON protocol

Python reads one JSON value from stdin and writes exactly one JSON object to
stdout. Use `json.dump(..., allow_nan=False)` or equivalent. Put diagnostics on
stderr, never stdout. The runner captures stderr, includes up to 4,000 characters
in nonzero-exit errors, and discards it after successful runs. Avoid logging secrets.

Input is JSON-serializable, otherwise model-specific. The supplied example uses:

- `asOf`: timezone-aware evaluation cutoff.
- `history`: rows with `marketId`, `observedAt`, `resolvedAt`, numeric `signal`,
  and binary `outcome`. Outcomes encode YES as 1 and NO as 0.
- `markets`: current rows with `venue`, `marketId`, timezone-aware `observedAt`,
  and numeric `signal`, all available by `asOf`.
- `dataKind`: optional description of the data provenance.

An agent should capture actual discovery/market/history data into such a
snapshot and map its point-in-time features explicitly. The runner does not
fetch history or assume all strategies use the example's features.

Strict output shape (no extra top-level or forecast keys):

```json
{
  "forecasts": [
    {
      "venue": "kalshi",
      "marketId": "example-market",
      "probability": 0.6,
      "confidence": 0.0,
      "reason": "Example only; uncertainty is not calibrated."
    }
  ],
  "metrics": {"testRows": 4, "dataKind": "synthetic"}
}
```

`venue` must be `kalshi`. `probability` is the model's YES probability;
`confidence` is a separately defined score, both finite and in `[0,1]`.
Confidence has no universal statistical interpretation. The example uses zero
to signal that it has not estimated confidence. Market IDs must be nonblank and
at most 256 characters. Reasons are 1–4,000 characters. At most 10,000 forecasts
are accepted, and `(venue, marketId)` pairs must be unique. `metrics` is required;
values are finite numbers, strings up to 4,000 characters, booleans, or null, with
keys at most 128 characters. Nested objects/arrays are not accepted in metrics.
Empty forecasts and metrics are valid. Callers should additionally verify that
forecast IDs belong to their snapshot; the generic runner cannot infer an
arbitrary input's market schema.

## Evaluation procedure

The example sorts resolved history chronologically, holds out the final 25%
(by observation timestamp, keeping tied timestamps together), and excludes any
training label that was unavailable at the first test timestamp. Scaling is fit
inside a scikit-learn pipeline using training rows only. It reports holdout
Brier score and log loss, then refits on history resolved strictly before `asOf`
to forecast the current snapshot. It requires at least 12 eligible rows and both
classes in training. The example does not calibrate confidence or simulate trades.

For actual research:

1. Archive raw snapshots with observation, publication, and resolution times,
   market rules, corrections, and data provenance. Features must reflect what was
   available when the forecast would have been made. Never use final prices,
   revised future data, or labels as predictors. For repeated observations of a
   market/event, split or purge groups so related labels cannot leak across folds.
2. Use expanding or rolling walk-forward folds: train only on labels resolved
   before each prediction time. Purge overlapping label windows and introduce an
   embargo when information persists across boundaries. Fit preprocessing,
   feature selection, tuning, and calibration inside each training fold; reserve
   a later untouched period for final evaluation. See scikit-learn's
   [leakage guidance](https://scikit-learn.org/stable/common_pitfalls.html).
3. Compare Brier/log loss and calibration against simple base rates and available
   market probabilities, with sample sizes and uncertainty. Account for market
   selection, missing/delisted markets, correlated outcomes, and regime changes.
   A small synthetic score proves neither accuracy nor profit.
4. If evaluating a trading rule separately, use executable historical bid/ask,
   spreads, venue fees, slippage, latency, depth/partial fills, funding and capital
   constraints, and settlement rules. Document all transaction-cost assumptions.
   Report gross and net results and sensitivity; do not turn forecast scores
   into profit claims. This example has no such cost or execution model.
5. Record user feedback as explicit hypotheses or constraints (features, horizon,
   exclusions, risk preferences). Version changes and test on subsequent unseen
   periods. Repeatedly changing a model to improve the same holdout overfits that
   holdout; keep the final test untouched and report failed experiments too.

## Execution boundary

This executes **trusted local user code, not an OS sandbox**. Python has the
local user's filesystem and network access and can read credentials from files
or intentionally launch other programs. Do not run untrusted model source.
Environment filtering does not prevent a model from loading a credential file.

The runner invokes an executable with an argument array, `shell: false`, and
Python `-I` (isolated import/environment behavior). The inherited environment
allowlist is only `PATH` and, on Windows, `SystemRoot`; fixed UTF-8/unbuffered and
single-thread numerical-library settings are added. It does not inherit exchange
credentials, HOME, PYTHONPATH, or arbitrary environment variables. Never embed
credentials in model source or input. `options.python` is an executable path/name,
not a shell command or command with arguments.

Source and serialized input are each limited to 1 MiB. Combined stdout/stderr is
limited to 1 MiB. Timeout defaults to 30 seconds, accepts integer milliseconds
from 1 to 300,000, and includes stdin delivery and Python startup. Invalid JSON,
schema failures, spawn failures, nonzero exits, timeouts, and excessive output
reject the promise. On timeout/output failure the runner sends SIGKILL to the
POSIX process group (only the direct process on Windows). Deliberately detached
children can escape that group. There are no CPU, memory, filesystem, or network
quotas, and these limits do not constrain malicious code.

## Verified example run

Local proof on 2026-11-04 used Python 3.14.3 in the ignored
`agent/python/.venv`, with NumPy 2.5.4, pandas 3.1.0, and scikit-learn 1.9.1.
An existing `.venv` selected macOS Python 3.9, so the proof explicitly passed
`python: resolve("python/.venv/bin/python")` rather than relying on that environment.
To reproduce the proof from `agent/`, create that venv with a Python 3.11+
executable and install `python/requirements.txt`, then run:

```sh
bun -e 'import {readFile} from "node:fs/promises"; import {resolve} from "node:path"; import {runModel} from "./src/models"; console.log(await runModel("example-proof", await readFile("python/examples/logistic.py", "utf8"), JSON.parse(await readFile("python/fixtures/snapshot.json", "utf8")), {python:resolve("python/.venv/bin/python"), timeoutMs:60000}));'
```

The source hash was
`4a9edb694042a17805f3759a11d7c657771fc4e3aec95cf1b437ccd8d01afaca`.
The validated output had 12 training rows, 4 test rows, a test boundary of
`2026-01-13T00:00:00+00:00`, and one forecast for `kalshi/synthetic-open`.
The synthetic holdout Brier score was `0.14707287369262367` and log loss was
`0.4488749738505618`; these are fixture checks, not empirical market evidence.
The forecast probability was `0.7333407665749795` with uncalibrated confidence `0`.

The six stdlib runner tests passed, including malformed output, timeout, both
output-stream bounds, environment credential removal, ID validation, and failure
reporting. The model module and its tests passed strict TypeScript checking.
