import { credentialPath, loadCredentials, applyCredentialEnvironment, KALSHI_BASE_URLS } from "./credentials";

// Load credentials before the SDK constructs its signing configuration.
const explicit = !!(process.env.KALSHI_API_ID || process.env.KALSHI_PRIVATE_KEY || process.env.KALSHI_PRIVATE_KEY_PEM);
if (!explicit) {
  const profile = loadCredentials();
  if (profile) applyCredentialEnvironment(profile);
}
const base = process.env.KALSHI_BASE_URL ?? KALSHI_BASE_URLS.production;
const testUrl = new URL(base);
const localFixture = process.env.KALSHI_MCP_TEST === "1" && testUrl.protocol === "http:" && testUrl.hostname === "127.0.0.1";
if (!Object.values(KALSHI_BASE_URLS).includes(base as typeof KALSHI_BASE_URLS.production) && !localFixture) {
  throw new Error("Only official Kalshi production and demo API URLs are allowed");
}
process.env.KALSHI_BASE_URL = base;
// Portable sessions never read a repository's CLI history or persist real account data.
process.env.DB_PATH = ":memory:";
process.env.KALSHI_MCP_PORTABLE = "1";
const { startPortableServer } = await import("./portable");
await startPortableServer({ credentialFile: credentialPath() });
