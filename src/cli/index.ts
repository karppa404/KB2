import "dotenv/config";
import { Command } from "commander";
import { getHistory, getHistoryByCommand } from "../db";
import { createKalshiCommand } from "./kalshi";
import { createPerplexityCommand } from "./perplexity";
import { createRiskCommand } from "./risk";
import { runLoggedCommand } from "./shared";

const program = new Command();

function parseJsonField(value: string | null): unknown {
  if (value === null) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

program
  .name("opencode")
  .description("Agent CLI for Kalshi trading + research")
  .version("0.1.0");

program.addCommand(createKalshiCommand());
program.addCommand(createPerplexityCommand());
program.addCommand(createRiskCommand());

program
  .command("history")
  .option("--limit <limit>", "Max history rows", "20")
  .option("--command <command>", "Filter by exact command text")
  .option("--pretty", "Print formatted output")
  .action(async (options) => {
    const parsedLimit = Number(options.limit);
    if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
      throw new Error(`Invalid limit: ${options.limit}`);
    }

    const args = { limit: parsedLimit, command: options.command };

    await runLoggedCommand({
      command: "history",
      args,
      pretty: options.pretty,
      run: async () => {
        const rows = options.command
          ? getHistoryByCommand(options.command, parsedLimit)
          : getHistory(parsedLimit);
        return rows.map((row) => ({
          ...row,
          args: parseJsonField(row.args),
          result: parseJsonField(row.result),
        }));
      },
    });
  });

await program.parseAsync(Bun.argv);
