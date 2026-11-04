// Opt-in installed-plugin test: both the model and Kalshi API are local fixtures.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const codex = process.env.KB2_CODEX_BIN ?? "/opt/homebrew/bin/codex";
const dir = mkdtempSync(join(tmpdir(), "kb2-codex-plugin-"));
const userConfig = Bun.TOML.parse(await Bun.file(join(homedir(), ".codex/config.toml")).text()) as any;
assert.equal(userConfig.plugins?.["kb2-kalshi@kb2-local"]?.enabled, true, "Install and enable kb2-kalshi@kb2-local first");
const order = { ticker: "T", action: "buy", side: "yes", count: 1, yes_price: 40 };
const writes: Array<[string, Record<string, unknown>]> = [
  ["place_order", order], ["buy", { ticker: "T", side: "yes", count: 1, yes_price: 40 }],
  ["sell", { ticker: "T", side: "yes", count: 1, yes_price: 40 }],
  ["amend_order", { orderId: "O", count: 2 }], ["cancel_order", { orderId: "O" }],
  ["batch_create", { orders: [order] }], ["batch_cancel", { orderIds: ["O"] }],
];
let namespace = "";
let selected = { name: "balance", args: {} as Record<string, unknown> };
let emitted = false;
let sequence = 0;
let approvals = 0;
const approvalDecision: { action: "accept" | "decline" } = { action: "decline" };
const requests: Array<{ method: string; path: string }> = [];
const modelFixture = Bun.serve({ port: 0, async fetch(req) {
  if (req.method === "GET") return Response.json({ models: [] });
  const input = await req.json() as any;
  assert(input.tools.some((t: any) => t.name === namespace), "Installed tools must appear in model discovery");
  const id = `fixture_${++sequence}`;
  const item = emitted
    ? { id, type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Fixture complete.", annotations: [] }] }
    : { id, type: "function_call", call_id: id, name: selected.name, namespace, arguments: JSON.stringify(selected.args) };
  emitted = true;
  const events = [
    { type: "response.output_item.done", output_index: 0, item },
    { type: "response.completed", response: { id, status: "completed", output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
  ];
  return new Response(events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
} });
const kalshiFixture = Bun.serve({ port: 0, fetch(req) {
  const path = new URL(req.url).pathname.replace("/trade-api/v2", "");
  requests.push({ method: req.method, path });
  if (path === "/account/limits") return Response.json({ read: { refill_rate: 100000, bucket_capacity: 100000 }, write: { refill_rate: 100000, bucket_capacity: 100000 } });
  if (path === "/account/endpoint_costs") return Response.json({ default_cost: 10, endpoint_costs: [] });
  if (path === "/portfolio/orders/O") return Response.json({ order: { ticker: "T", book_side: "bid", initial_count_fp: "1.00", yes_price_dollars: "0.4000", exchange_index: 1 } });
  return Response.json({ balance: 12345, fixture: "ok" });
} });

// Disable other integrations only in this subprocess; preserve the user's configuration.
const overrides = Object.keys(userConfig.plugins ?? {}).filter(key => key !== "kb2-kalshi@kb2-local")
  .flatMap(key => ["-c", `plugins.${key}.enabled=false`]);
for (const key of Object.keys(userConfig.mcp_servers ?? {})) overrides.push("-c", `mcp_servers.${key}.enabled=false`);
const child = Bun.spawn([codex, "app-server", "--stdio", ...overrides,
  "-c", "features.apps=false", "-c", "features.tool_search=false", "-c", "features.code_mode=false",
  "-c", "model_provider=kb2_mock", "-c", "model=gpt-fixture",
  "-c", "model_providers.kb2_mock.name=KB2Mock", "-c", `model_providers.kb2_mock.base_url=${modelFixture.url}`,
  "-c", "model_providers.kb2_mock.wire_api=responses", "-c", "model_providers.kb2_mock.requires_openai_auth=false",
], { env: { ...process.env, KALSHI_BASE_URL: `${kalshiFixture.url}trade-api/v2`, KALSHI_API_ID: "", KALSHI_PRIVATE_KEY: "", KALSHI_PRIVATE_KEY_PEM: "", DB_PATH: join(dir, "history.db") }, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
const stderr = new Response(child.stderr).text();
let counter = 0;
let completed: ((value: any) => void) | undefined;
type Pending = { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
const pending = new Map<number, Pending>();
function send(message: unknown) { child.stdin.write(JSON.stringify(message) + "\n"); child.stdin.flush(); }
function rpc(method: string, params: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = ++counter;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 30_000);
    pending.set(id, { resolve, reject, timer }); send({ id, method, params });
  });
}
const reader = (async () => {
  let buffer = "";
  for await (const chunk of child.stdout) {
    buffer += new TextDecoder().decode(chunk);
    let end: number;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      if (message.id !== undefined && !message.method) {
        const call = pending.get(message.id);
        if (call) { pending.delete(message.id); clearTimeout(call.timer); message.error ? call.reject(new Error(JSON.stringify(message.error))) : call.resolve(message.result); }
      } else if (message.id !== undefined) {
        assert.equal(message.method, "mcpServer/elicitation/request");
        assert.equal(message.params._meta?.codex_approval_kind, "mcp_tool_call");
        assert.equal(message.params.serverName, namespace.replace("mcp__", ""));
        approvals++;
        send({ id: message.id, result: { action: approvalDecision.action, content: approvalDecision.action === "accept" ? {} : null, _meta: null } });
      } else if (message.method === "turn/completed") completed?.(message.params);
    }
  }
})();
async function runTurn(threadId: string, name: string, args: Record<string, unknown>, action: "accept" | "decline") {
  selected = { name, args }; emitted = false; approvalDecision.action = action;
  let timer: ReturnType<typeof setTimeout>;
  const done = new Promise<any>((resolve, reject) => {
    completed = resolve; timer = setTimeout(() => reject(new Error(`Timeout: ${name} turn`)), 30_000);
  });
  try {
    await rpc("turn/start", { threadId, input: [{ type: "text", text: "Run the local fixture operation.", text_elements: [] }], effort: "low" });
    const result = await done; assert.equal(result.turn.status, "completed");
  } finally { clearTimeout(timer!); completed = undefined; }
}
try {
  await rpc("initialize", { clientInfo: { name: "kb2-installed-plugin-test", version: "1.0.0" }, capabilities: { experimentalApi: true, requestAttestation: false } });
  send({ method: "initialized" });
  const thread = await rpc("thread/start", { cwd: root, ephemeral: true, approvalPolicy: "on-request", approvalsReviewer: "user" });
  const inventory = await rpc("mcpServerStatus/list", { threadId: thread.thread.id, limit: 100 });
  const server = inventory.data.find((s: any) => s.pluginId === "kb2-kalshi@kb2-local");
  assert(server, "Installed plugin must load in a fresh chat");
  assert.equal(server.runtimeStatus, "connected"); assert.equal(server.toolsError, null);
  assert.equal(Object.keys(server.tools).length, 28);
  namespace = `mcp__${server.name}`;
  await runTurn(thread.thread.id, "balance", {}, "decline");
  assert.equal(approvals, 0); assert(requests.some(r => r.path === "/portfolio/balance"));
  for (const [name, args] of writes) {
    const before = requests.length; const approvalCount: number = approvals;
    await runTurn(thread.thread.id, name, args, "decline");
    assert.equal(approvals, approvalCount + 1, `${name} must prompt`);
    assert.equal(requests.length, before, `${name} denial must send no Kalshi requests`);
    await runTurn(thread.thread.id, name, args, "accept");
    assert.equal(approvals, approvalCount + 2, `${name} must prompt again`);
    assert.equal(requests.slice(before).filter(r => r.method !== "GET").length, 1, `${name} approval must send exactly one write`);
  }
  console.log("Installed Codex plugin: 28 tools discovered; read auto-approved; all 7 writes prompted, denied without requests, and approved against local mocks.");
} finally {
  child.kill(); await child.exited; await reader;
  for (const call of pending.values()) clearTimeout(call.timer);
  kalshiFixture.stop(true); modelFixture.stop(true); rmSync(dir, { recursive: true, force: true });
  // Host diagnostics are consumed without exposing unrelated configuration or credentials.
  await stderr;
}
