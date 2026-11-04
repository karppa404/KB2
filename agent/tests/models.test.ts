import { afterAll, expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { modelOutputSchema, modelWorkspace, runModel } from "../src/models";

const prefix = `test-${randomUUID()}`;
const ids: string[] = [];
const python = process.env.TEST_PYTHON ?? "python3";
function run(source: string, input: unknown = {}, timeoutMs = 3000) {
  const id = `${prefix}-${ids.length}`;
  ids.push(id);
  return runModel(id, source, input, { python, timeoutMs });
}
afterAll(async () => {
  await Promise.all(ids.map(id => rm(join(modelWorkspace, id), { recursive: true, force: true })));
});

const source = `import json, sys
data = json.load(sys.stdin)
print('diagnostic only', file=sys.stderr)
print(json.dumps({'forecasts': [{'venue':'kalshi', 'marketId':data['marketId'], 'probability':0.6, 'confidence':0.2, 'reason':'stdlib fixture'}], 'metrics':{'rows':2}}))
`;

test("runs stdin JSON, validates forecasts, hashes exact source and saves editable model", async () => {
  const result = await run(source, { marketId: "fixture" });
  expect(result.version).toBe(createHash("sha256").update(source).digest("hex"));
  expect(result.output.forecasts[0]?.marketId).toBe("fixture");
  expect(await readFile(join(modelWorkspace, ids[0]!, "model.py"), "utf8")).toBe(source);
});

test("rejects non-JSON, invalid probabilities, extra fields, and duplicate markets", async () => {
  for (const text of ["not json", '{"forecasts":[],"metrics":{},"orders":[]}', '{"forecasts":[],"metrics":{"bad":NaN}}']) {
    await expect(run(`print(${JSON.stringify(text)})`)).rejects.toThrow();
  }
  const forecast = { venue: "kalshi", marketId: "x", probability: 2, confidence: 0.5, reason: "x" };
  expect(modelOutputSchema.safeParse({ forecasts: [forecast], metrics: {} }).success).toBe(false);
  forecast.probability = 0.5;
  expect(modelOutputSchema.safeParse({ forecasts: [forecast, forecast], metrics: {} }).success).toBe(false);
});

test("times out and bounds stdout and stderr", async () => {
  const started = Date.now();
  await expect(run("import time\ntime.sleep(20)", {}, 100)).rejects.toThrow("timed out");
  expect(Date.now() - started).toBeLessThan(3000);
  for (const stream of ["stdout", "stderr"]) {
    await expect(run(`import sys\nsys.${stream}.write('x' * 1100000)`)).rejects.toThrow("exceeded");
  }
});

test("uses a credential-free allowlisted environment and isolated Python", async () => {
  const names = ["KALSHI_API_KEY", "POLYMARKET_PRIVATE_KEY", "UNEXPECTED_SECRET", "PYTHONPATH"];
  const previous = names.map(name => process.env[name]);
  try {
    for (const name of names) process.env[name] = "secret-test-sentinel";
    const result = await run(`import json, os, sys
assert sys.flags.isolated
assert not any(name in os.environ for name in ${JSON.stringify(names)})
assert not any('secret-test-sentinel' in value for value in os.environ.values())
print(json.dumps({'forecasts': [], 'metrics': {'isolated': True}}))`);
    expect(result.output.metrics.isolated).toBe(true);
  } finally {
    names.forEach((name, i) => {
      if (previous[i] === undefined) delete process.env[name];
      else process.env[name] = previous[i];
    });
  }
});

test("rejects path traversal and invalid resource options before running", async () => {
  for (const id of ["../escape", "a/b", ".", "", "x;touch nope", "a".repeat(65)]) {
    await expect(runModel(id, source, {}, { python })).rejects.toThrow("strategy ID");
  }
  await expect(run(source, {}, 0)).rejects.toThrow("timeout");
  await expect(runModel(`${prefix}-undefined`, source, undefined, { python })).rejects.toThrow("input");
  await expect(run("x".repeat(1024 * 1024 + 1))).rejects.toThrow("source");
});

test("reports interpreter and Python failures", async () => {
  await expect(run("raise ValueError('fixture error')")).rejects.toThrow("fixture error");
  await expect(runModel(`${prefix}-missing`, source, {}, { python: "/no/such/python" })).rejects.toThrow();
  ids.push(`${prefix}-missing`);
});
