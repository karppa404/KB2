import { Command } from "commander";
import { getRiskSummary, kellySize } from "../risk";
import { runLoggedCommand } from "./shared";

function toNumber(value: string | undefined, fieldName: string): number {
  if (value === undefined) {
    throw new Error(`Missing required numeric value for ${fieldName}`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid number for ${fieldName}: ${value}`);
  }
  return parsed;
}

export function createRiskCommand(): Command {
  const risk = new Command("risk").description("Risk summary and position sizing tools");

  risk
    .command("summary")
    .option("--pretty", "Print formatted output")
    .action(async (options) => {
      await runLoggedCommand({
        command: "risk summary",
        args: {},
        pretty: options.pretty,
        run: () => getRiskSummary(),
      });
    });

  risk
    .command("kelly")
    .requiredOption("--prob <prob>")
    .requiredOption("--odds <odds>")
    .requiredOption("--bankroll <bankroll>")
    .option("--fraction <fraction>")
    .option("--pretty", "Print formatted output")
    .action(async (options) => {
      const prob = toNumber(options.prob, "prob");
      const odds = toNumber(options.odds, "odds");
      const bankroll = toNumber(options.bankroll, "bankroll");
      const fraction =
        options.fraction === undefined ? undefined : toNumber(options.fraction, "fraction");

      await runLoggedCommand({
        command: "risk kelly",
        args: { prob, odds, bankroll, fraction },
        pretty: options.pretty,
        run: async () => ({
          size: kellySize({ prob, odds, bankroll, fraction }),
          inputs: { prob, odds, bankroll, fraction: fraction ?? 0.5 },
        }),
      });
    });

  return risk;
}
