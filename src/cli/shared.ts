import { logCommand } from "../db";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function printPretty(result: unknown): void {
  if (Array.isArray(result)) {
    if (result.length > 0 && result.every((item) => isPlainObject(item))) {
      console.table(result);
      return;
    }
    console.log(result);
    return;
  }

  if (isPlainObject(result)) {
    const entries = Object.entries(result);
    if (entries.length > 0 && entries.every(([, value]) => !isPlainObject(value) && !Array.isArray(value))) {
      console.table([result]);
      return;
    }
    console.dir(result, { depth: null });
    return;
  }

  console.log(result);
}

export async function runLoggedCommand(opts: {
  command: string;
  args: Record<string, unknown>;
  pretty?: boolean;
  run: () => Promise<unknown>;
}): Promise<void> {
  const startedAt = Date.now();

  try {
    const result = await opts.run();
    const duration = Date.now() - startedAt;

    logCommand({
      command: opts.command,
      args: opts.args,
      result,
      duration_ms: duration,
    });

    if (opts.pretty) {
      printPretty(result);
      return;
    }

    console.log(JSON.stringify(result));
  } catch (error) {
    const duration = Date.now() - startedAt;
    const message = error instanceof Error ? error.message : String(error);

    logCommand({
      command: opts.command,
      args: opts.args,
      error: message,
      duration_ms: duration,
    });

    console.error(
      JSON.stringify({
        error: message,
        command: opts.command,
        ts: new Date().toISOString(),
      }),
    );

    process.exitCode = 1;
  }
}
