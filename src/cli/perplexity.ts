import { Command } from "commander";
import { searchPerplexity } from "../perplexity";
import { runLoggedCommand } from "./shared";

function toNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid number: ${value}`);
  }
  return parsed;
}

export function createPerplexityCommand(): Command {
  const perplexity = new Command("perplexity").description("Perplexity web-search commands");

  perplexity
    .command("search <query>")
    .option("--model <model>")
    .option("--max-tokens <maxTokens>")
    .option("--pretty", "Print formatted output")
    .action(async (query, options) => {
      const params = {
        query,
        model: options.model,
        maxTokens: toNumber(options.maxTokens),
      };

      await runLoggedCommand({
        command: "perplexity search",
        args: params,
        pretty: options.pretty,
        run: () =>
          searchPerplexity(query, {
            model: options.model,
            maxTokens: toNumber(options.maxTokens),
          }),
      });
    });

  return perplexity;
}
