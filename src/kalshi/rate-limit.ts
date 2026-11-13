import type { AxiosInstance, InternalAxiosRequestConfig } from "axios";
import type { BucketLimit, GetAccountApiLimitsResponse, GetAccountEndpointCostsResponse } from "kalshi-typescript";

const sleep = (ms: number) => Bun.sleep(ms);

export class TokenBucket {
  private tokens: number;
  private updated: number;

  constructor(private limit: BucketLimit, private now = () => performance.now(), private wait = sleep) {
    this.tokens = limit.bucket_capacity;
    this.updated = now();
    this.configure(limit);
  }

  configure(limit: BucketLimit) {
    if (!Number.isFinite(limit.refill_rate) || limit.refill_rate <= 0 ||
        !Number.isFinite(limit.bucket_capacity) || limit.bucket_capacity <= 0) {
      throw new Error("Invalid Kalshi rate limit budget");
    }
    this.refill();
    this.limit = limit;
    this.tokens = Math.min(this.tokens, limit.bucket_capacity);
  }

  private refill() {
    const now = this.now();
    this.tokens = Math.min(this.limit.bucket_capacity,
      this.tokens + Math.max(0, now - this.updated) * this.limit.refill_rate / 1000);
    this.updated = now;
  }

  async acquire(cost: number) {
    if (!Number.isFinite(cost) || cost <= 0) throw new Error("Invalid Kalshi request token cost");
    for (;;) {
      if (cost > this.limit.bucket_capacity) {
        throw new Error(`Request costs ${cost} tokens but bucket capacity is ${this.limit.bucket_capacity}; reduce the batch size`);
      }
      this.refill();
      if (this.tokens >= cost) {
        this.tokens -= cost;
        return;
      }
      await this.wait(Math.ceil((cost - this.tokens) * 1000 / this.limit.refill_rate));
    }
  }
}

export function requestCost(method: string, path: string, data: unknown, costs: GetAccountEndpointCostsResponse) {
  const match = costs.endpoint_costs.find(endpoint => {
    const pattern = endpoint.path.split("/").map(part => {
      if (part.startsWith(":" ) || part.startsWith("{")) return "[^/]+";
      if (part.startsWith("*")) return ".*";
      return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }).join("/");
    return endpoint.method.toUpperCase() === method && new RegExp(`^${pattern}$`).test(path);
  });
  let count = 1;
  if (path.endsWith("/orders/batched") && (method === "POST" || method === "DELETE")) {
    const body = typeof data === "string" ? JSON.parse(data) : data;
    const items = body?.orders ?? body?.ids;
    if (!Array.isArray(items) || items.length === 0) throw new Error("Order batch must contain at least one order");
    count = items.length;
  }
  return (match?.cost ?? costs.default_cost) * count;
}

export function installRateLimitRetry(client: AxiosInstance, wait = sleep) {
  client.interceptors.response.use(undefined, async error => {
    const config = error.config as (InternalAxiosRequestConfig & { rateLimitRetries?: number }) | undefined;
    const attempt = config?.rateLimitRetries ?? 0;
    // Only explicit rejections are safe to replay; never retry ambiguous write failures.
    if (error.response?.status !== 429 || !config || attempt >= 4) throw error;
    await wait(250 * 2 ** attempt + Math.floor(Math.random() * 100));
    config.rateLimitRetries = attempt + 1;
    return client.request(config);
  });
}

export function installRateLimitChecks(client: AxiosInstance, load: () => Promise<{
  limits: GetAccountApiLimitsResponse;
  costs: GetAccountEndpointCostsResponse;
}>) {
  let metadata: Awaited<ReturnType<typeof load>> | undefined;
  let refreshing: Promise<void> | undefined;
  let refreshedAt = -Infinity;
  let read: TokenBucket;
  let write: TokenBucket;

  // Register after SDK construction: Axios runs request interceptors in reverse,
  // so waiting happens before the SDK generates timestamped signatures.
  client.interceptors.request.use(async config => {
    if (!metadata || performance.now() - refreshedAt > 60_000) {
      refreshing ??= load().then(result => {
        if (metadata) {
          read.configure(result.limits.read);
          write.configure(result.limits.write);
        } else {
          read = new TokenBucket(result.limits.read);
          write = new TokenBucket(result.limits.write);
        }
        metadata = result;
        refreshedAt = performance.now();
      }).finally(() => { refreshing = undefined; });
      await refreshing;
    }
    const method = (config.method ?? "GET").toUpperCase();
    const path = new URL(config.url!, config.baseURL).pathname;
    const cost = requestCost(method, path, config.data, metadata!.costs);
    // ponytail: one conservative Write bucket across shards; split by shard if throughput needs it.
    await (method === "GET" ? read : write).acquire(cost);
    return config;
  });
}
