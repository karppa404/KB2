import { expect, test } from "bun:test";
import axios, { AxiosError, type AxiosAdapter } from "axios";
import { installRateLimitChecks, installRateLimitRetry, requestCost, TokenBucket } from "./rate-limit";

test("token bucket allows bursts, refills continuously, and caps idle credits", async () => {
  let now = 0;
  const waits: number[] = [];
  const bucket = new TokenBucket({ refill_rate: 100, bucket_capacity: 300 }, () => now, async ms => {
    waits.push(ms);
    now += ms;
  });
  await bucket.acquire(300);
  await bucket.acquire(10);
  expect(waits).toEqual([100]);
  now += 10_000;
  await bucket.acquire(300);
  await bucket.acquire(10);
  expect(waits).toEqual([100, 100]);
  await expect(bucket.acquire(301)).rejects.toThrow("reduce the batch size");
});

test("concurrent waiters recheck the bucket before spending", async () => {
  let now = 0;
  const wake: Array<() => void> = [];
  const bucket = new TokenBucket({ refill_rate: 10, bucket_capacity: 10 }, () => now,
    () => new Promise<void>(resolve => wake.push(resolve)));
  await bucket.acquire(10);
  let finished = 0;
  const first = bucket.acquire(10).then(() => finished++);
  const second = bucket.acquire(10).then(() => finished++);
  now = 1000;
  wake.splice(0).forEach(resolve => resolve());
  await first;
  expect(finished).toBe(1);
  now = 2000;
  wake.splice(0).forEach(resolve => resolve());
  await second;
  expect(finished).toBe(2);
});

test("changed limits preserve spent tokens and reject invalid budgets", async () => {
  let now = 0;
  const bucket = new TokenBucket({ refill_rate: 10, bucket_capacity: 10 }, () => now, async ms => { now += ms; });
  await bucket.acquire(10);
  bucket.configure({ refill_rate: 20, bucket_capacity: 20 });
  await bucket.acquire(10);
  expect(now).toBe(500);
  expect(() => bucket.configure({ refill_rate: 0, bucket_capacity: 10 })).toThrow();
  await expect(bucket.acquire(NaN)).rejects.toThrow();
});

const costs = { default_cost: 10, endpoint_costs: [
  { method: "DELETE", path: "/trade-api/v2/portfolio/orders/batched", cost: 2 },
  { method: "DELETE", path: "/trade-api/v2/portfolio/orders/:order_id", cost: 2 },
  { method: "GET", path: "/trade-api/v2/cfbenchmarks/*endpoint", cost: 50 },
] };

test("endpoint costs match methods/routes and charge every batch item", () => {
  const root = "/trade-api/v2/portfolio/orders";
  expect(requestCost("GET", root, undefined, costs)).toBe(10);
  expect(requestCost("DELETE", `${root}/abc`, undefined, costs)).toBe(2);
  expect(requestCost("GET", "/trade-api/v2/cfbenchmarks/a/b", undefined, costs)).toBe(50);
  expect(requestCost("POST", `${root}/batched`, { orders: Array(25).fill({}) }, costs)).toBe(250);
  expect(requestCost("DELETE", `${root}/batched`, JSON.stringify({ ids: Array(25).fill("id") }), costs)).toBe(50);
  expect(() => requestCost("POST", `${root}/batched`, { orders: [] }, costs)).toThrow();
});

test("transport shares metadata, separates budgets, and blocks oversized batches before sending", async () => {
  let loads = 0;
  const sent: string[] = [];
  const client = axios.create({ adapter: async config => {
    sent.push(config.url!);
    return { data: {}, status: 200, statusText: "OK", headers: {}, config };
  } });
  installRateLimitChecks(client, async () => {
    loads++;
    return { costs, limits: { usage_tier: "test", grants: [], read: { refill_rate: 10, bucket_capacity: 10 }, write: { refill_rate: 10, bucket_capacity: 10 } } };
  });
  await Promise.all([
    client.get("https://test.invalid/trade-api/v2/markets"),
    client.post("https://test.invalid/trade-api/v2/portfolio/orders", {}),
  ]);
  expect(loads).toBe(1);
  expect(sent).toHaveLength(2);
  await expect(client.post("https://test.invalid/trade-api/v2/portfolio/orders/batched", { orders: [{}, {}] })).rejects.toThrow("20 tokens");
  expect(sent).toHaveLength(2);
});

test("failed metadata check prevents sending requests and can recover", async () => {
  let loads = 0;
  let sends = 0;
  const client = axios.create({ adapter: async config => {
    sends++;
    return { data: {}, status: 200, statusText: "OK", headers: {}, config };
  } });
  installRateLimitChecks(client, async () => {
    if (++loads === 1) throw new Error("metadata unavailable");
    return { costs, limits: { usage_tier: "test", grants: [], read: { refill_rate: 100, bucket_capacity: 100 }, write: { refill_rate: 100, bucket_capacity: 100 } } };
  });
  await expect(client.get("https://test.invalid/markets")).rejects.toThrow("metadata unavailable");
  expect(sends).toBe(0);
  await client.get("https://test.invalid/markets");
  expect(sends).toBe(1);
});

test("429 retries back off, stop after four retries, and do not replay other failures", async () => {
  for (const status of [429, 500, 401, 0]) {
    let calls = 0;
    const waits: number[] = [];
    const adapter: AxiosAdapter = async config => {
      calls++;
      throw new AxiosError("failure", undefined, config, undefined,
        status ? { data: {}, status, statusText: "failure", headers: {}, config } : undefined);
    };
    const client = axios.create({ adapter });
    installRateLimitRetry(client, async ms => { waits.push(ms); });
    await expect(client.post("https://test.invalid/orders", {})).rejects.toThrow("failure");
    expect(calls).toBe(status === 429 ? 5 : 1);
    expect(waits.length).toBe(status === 429 ? 4 : 0);
    waits.forEach((ms, i) => {
      expect(ms).toBeGreaterThanOrEqual(250 * 2 ** i);
      expect(ms).toBeLessThan(250 * 2 ** i + 100);
    });
  }
});

test("429 retry succeeds and reruns request interceptors for fresh authentication", async () => {
  let calls = 0;
  let signed = 0;
  const client = axios.create({ adapter: async config => {
    if (++calls === 1) throw new AxiosError("limited", undefined, config, undefined,
      { data: {}, status: 429, statusText: "limited", headers: {}, config });
    return { data: { ok: true }, status: 200, statusText: "OK", headers: {}, config };
  } });
  client.interceptors.request.use(config => { signed++; return config; });
  installRateLimitRetry(client, async () => {});
  expect((await client.get("https://test.invalid/markets")).data).toEqual({ ok: true });
  expect(signed).toBe(2);
});
