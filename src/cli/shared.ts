import { logCommand } from "../db";

function printPretty(result: unknown): void {
  console.log(JSON.stringify(result, null, 2));
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
