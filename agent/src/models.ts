import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export const modelOutputSchema = z.strictObject({
  forecasts: z.array(z.strictObject({
    venue: z.enum(["kalshi", "polymarket"]),
    marketId: z.string().trim().min(1).max(256),
    probability: z.number().min(0).max(1),
    confidence: z.number().min(0).max(1),
    reason: z.string().min(1).max(4000),
  })).max(10_000),
  metrics: z.record(z.string().max(128), z.union([z.number(), z.string().max(4000), z.boolean(), z.null()])),
}).superRefine(({ forecasts }, ctx) => {
  const seen = new Set<string>();
  for (const forecast of forecasts) {
    const key = JSON.stringify([forecast.venue, forecast.marketId]);
    if (seen.has(key)) ctx.addIssue({ code: "custom", message: "Duplicate forecast market" });
    seen.add(key);
  }
});

export type ModelOutput = z.infer<typeof modelOutputSchema>;
const agentRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const modelWorkspace = join(agentRoot, "state", "models");
const maxBytes = 1024 * 1024;

/** Runs trusted local code. Environment filtering and resource bounds are NOT an OS sandbox. */
export async function runModel(
  strategyId: string,
  source: string,
  input: unknown,
  options: { python?: string; timeoutMs?: number } = {},
): Promise<{ version: string; output: ModelOutput }> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(strategyId)) throw new Error("Invalid model strategy ID");
  if (typeof source !== "string" || !source.trim() || Buffer.byteLength(source) > maxBytes) throw new Error("Invalid model source (maximum 1 MiB)");
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) throw new Error("Model timeout must be 1..300000 ms");
  const serialized = JSON.stringify(input);
  if (serialized === undefined || Buffer.byteLength(serialized) > maxBytes) throw new Error("Invalid model input (maximum 1 MiB JSON)");
  const version = createHash("sha256").update(source).digest("hex");
  const directory = join(modelWorkspace, strategyId);
  await mkdir(directory, { recursive: true });
  // Reject symlinked workspace ancestors rather than following them outside state.
  if (await realpath(directory) !== directory) throw new Error("Model workspace must not contain symlinks");
  const runDirectory = await mkdtemp(join(directory, ".run-"));
  try {
    const script = join(runDirectory, "model.py");
    await writeFile(script, source, { mode: 0o600 });
    const current = join(runDirectory, "current.py");
    await writeFile(current, source, { mode: 0o600 });
    await rename(current, join(directory, "model.py"));
    const env: Record<string, string> = {
      PYTHONIOENCODING: "utf-8", PYTHONUNBUFFERED: "1",
      OMP_NUM_THREADS: "1", OPENBLAS_NUM_THREADS: "1", MKL_NUM_THREADS: "1",
    };
    // Deliberately exclude HOME, PYTHONPATH, virtualenv hooks and all credential variables.
    if (process.env.PATH) env.PATH = process.env.PATH;
    if (process.platform === "win32" && process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
    const stdout = await new Promise<string>((resolveOutput, reject) => {
      const child = spawn(options.python ?? join(agentRoot, ".venv", "bin", "python"), ["-I", script], {
        cwd: directory, env, shell: false, detached: process.platform !== "win32",
        stdio: ["pipe", "pipe", "pipe"],
      });
      let output = Buffer.alloc(0);
      let stderr = Buffer.alloc(0);
      let total = 0;
      let settled = false;
      const stop = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL");
          else child.kill("SIGKILL");
        } catch { /* Process may already have exited. */ }
        child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy();
        reject(error);
      };
      const timer = setTimeout(() => stop(new Error(`Model timed out after ${timeoutMs} ms`)), timeoutMs);
      child.on("error", stop);
      child.stdin.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code !== "EPIPE") stop(error);
      });
      for (const [stream, isOutput] of [[child.stdout, true], [child.stderr, false]] as const) {
        stream.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > maxBytes) return stop(new Error("Model output exceeded 1 MiB (stdout + stderr)"));
          if (isOutput) output = Buffer.concat([output, chunk]);
          else stderr = Buffer.concat([stderr, chunk]);
        });
      }
      child.on("close", (code, signal) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code !== 0) reject(new Error(`Model failed (${signal ?? code}): ${stderr.toString("utf8").slice(0, 4000)}`));
        else resolveOutput(output.toString("utf8"));
      });
      child.stdin.end(serialized);
    });
    return { version, output: modelOutputSchema.parse(JSON.parse(stdout)) };
  } finally {
    await rm(runDirectory, { recursive: true, force: true });
  }
}
