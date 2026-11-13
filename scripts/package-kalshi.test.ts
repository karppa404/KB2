import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validatePackage } from "./package-kalshi";

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "kalshi-package-"));
  temporary.push(directory);
  await mkdir(join(directory, ".codex-plugin"));
  const manifest = { $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json", name: "kalshi", version: "1.0.0" };
  await writeFile(join(directory, "plugin.json"), JSON.stringify(manifest));
  await writeFile(join(directory, ".codex-plugin/plugin.json"), JSON.stringify({ name: "kalshi", version: "1.0.0" }));
  const server = { type: "stdio", command: "bun", args: ["${PLUGIN_ROOT}/server.js"] };
  await writeFile(join(directory, "mcp.json"), JSON.stringify({ $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json", mcpServers: { kalshi: server } }));
  await writeFile(join(directory, ".mcp.json"), JSON.stringify({ mcpServers: { kalshi: server } }));
  await writeFile(join(directory, "server.js"), "// fixture");
  await writeFile(join(directory, "setup.js"), "// fixture");
  return directory;
}

test("package validation rejects credential files and symlinks", async () => {
  const directory = await fixture();
  await expect(validatePackage(directory)).resolves.toContain("server.js");
  await writeFile(join(directory, "bot.pem"), "fixture only");
  await expect(validatePackage(directory)).rejects.toThrow();
  await rm(join(directory, "bot.pem"));
  await symlink(join(directory, "server.js"), join(directory, "linked.js"));
  await expect(validatePackage(directory)).rejects.toThrow("Symlink");
});

test("package validation rejects missing assets and embedded credentials", async () => {
  const directory = await fixture();
  const manifestPath = join(directory, "plugin.json");
  const manifest = await Bun.file(manifestPath).json();
  manifest.extensions = { "com.openai": { interface: { logo: "./missing.svg" } } };
  await writeFile(manifestPath, JSON.stringify(manifest));
  await expect(validatePackage(directory)).rejects.toThrow();
  delete manifest.extensions;
  await writeFile(manifestPath, JSON.stringify(manifest));
  const configPath = join(directory, "mcp.json");
  const config = await Bun.file(configPath).json();
  config.mcpServers.kalshi.env = { KALSHI_API_ID: "fixture-do-not-package" };
  await writeFile(configPath, JSON.stringify(config));
  await expect(validatePackage(directory)).rejects.toThrow("Credentials");
});
