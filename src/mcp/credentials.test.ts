import { afterEach, describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyCredentialEnvironment, credentialStatus, KALSHI_BASE_URLS, loadCredentials, removeCredentials, saveCredentials, validateCredentials } from "./credentials";
import { startSetupServer } from "./setup";

const directories: string[] = [];
const servers: Array<ReturnType<typeof startSetupServer>> = [];
const pem = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const profile = { apiId: "test-api-id", privateKeyPem: pem, environment: "demo" as const };
function path() { const directory = mkdtempSync(join(tmpdir(), "kalshi-credentials-")); directories.push(directory); return join(directory, "private", "credentials.json"); }
afterEach(() => { for (const server of servers.splice(0)) server.stop(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe("credential storage", () => {
  test("round trips only owner-readable credentials and safe status", () => {
    const file = path();
    expect(loadCredentials(file)).toBeUndefined();
    saveCredentials(profile, file);
    expect(lstatSync(file).mode & 0o777).toBe(0o600);
    expect(lstatSync(join(file, "..")).mode & 0o777).toBe(0o700);
    expect(loadCredentials(file)).toEqual({ version: 1, ...profile });
    const status = credentialStatus(file);
    expect(status.configured).toBe(true);
    expect(JSON.stringify(status)).not.toContain(pem);
    expect(JSON.stringify(status)).not.toContain(profile.apiId);
    saveCredentials({ ...profile, environment: "production" }, file);
    expect(loadCredentials(file)?.environment).toBe("production");
    expect(removeCredentials(file)).toBe(true);
    expect(removeCredentials(file)).toBe(false);
    expect(existsSync(file)).toBe(false);
  });

  test("rejects insecure files, directories and symlinks without exposing credentials", () => {
    const file = path(); saveCredentials(profile, file);
    chmodSync(file, 0o644);
    expect(() => loadCredentials(file)).toThrow("owned");
    expect(() => saveCredentials(profile, file)).toThrow("owned");
    chmodSync(file, 0o600);
    chmodSync(join(file, ".."), 0o755);
    expect(() => loadCredentials(file)).toThrow("owned");
    chmodSync(join(file, ".."), 0o700);
    const link = join(file, "..", "link.json"); symlinkSync(file, link);
    expect(() => loadCredentials(link)).toThrow();
    expect(() => saveCredentials(profile, link)).toThrow();
    expect(() => removeCredentials(link)).toThrow();
    expect(readFileSync(file, "utf8")).toContain(profile.apiId);
    const linkedDirectory = join(file, "..", "linked-directory"); symlinkSync(join(file, ".."), linkedDirectory);
    expect(() => loadCredentials(join(linkedDirectory, "credentials.json"))).toThrow();
  });

  test("validates supported keys and environment without arbitrary URLs", () => {
    expect(validateCredentials(profile).version).toBe(1);
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    expect(validateCredentials({ ...profile, privateKeyPem: rsa }).privateKeyPem).toBe(rsa);
    const weak = generateKeyPairSync("rsa", { modulusLength: 1024 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    expect(() => validateCredentials({ ...profile, privateKeyPem: weak })).toThrow("2048");
    expect(() => validateCredentials({ ...profile, privateKeyPem: "secret-malformed" })).toThrow("private key PEM");
    expect(() => validateCredentials({ ...profile, environment: "https://attacker.example" })).toThrow();
    expect(() => validateCredentials({ ...profile, apiId: "abc\r\nHeader: value" })).toThrow();
    expect(() => validateCredentials({ ...profile, version: 2 })).toThrow();
  });

  test("applies only matching official host and clears stale key file path", () => {
    const previous = { id: process.env.KALSHI_API_ID, pem: process.env.KALSHI_PRIVATE_KEY_PEM, path: process.env.KALSHI_PRIVATE_KEY, url: process.env.KALSHI_BASE_URL };
    try {
      process.env.KALSHI_PRIVATE_KEY = "stale.pem";
      applyCredentialEnvironment(validateCredentials(profile));
      expect(process.env.KALSHI_BASE_URL).toBe(KALSHI_BASE_URLS.demo);
      expect(process.env.KALSHI_PRIVATE_KEY).toBeUndefined();
      expect(process.env.KALSHI_PRIVATE_KEY_PEM).toBe(pem);
    } finally {
      for (const [key, value] of Object.entries({ KALSHI_API_ID: previous.id, KALSHI_PRIVATE_KEY_PEM: previous.pem, KALSHI_PRIVATE_KEY: previous.path, KALSHI_BASE_URL: previous.url })) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  });
});

describe("loopback credential form", () => {
  test("requires unguessable path, matching host and same-origin JSON POST", async () => {
    const file = path(), server = startSetupServer({ path: file }); servers.push(server);
    const url = new URL(server.url);
    expect(url.hostname).toBe("127.0.0.1");
    expect(url.pathname).toMatch(/^\/setup\/[a-f0-9]{64}$/);
    const page = await fetch(server.url);
    expect(page.status).toBe(200);
    expect(page.headers.get("cache-control")).toBe("no-store");
    expect(page.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(await page.text()).not.toContain(pem);
    expect((await fetch(url.origin)).status).toBe(404);
    expect((await fetch(server.url, { method: "POST", headers: { Origin: "https://attacker.example", "Content-Type": "application/json" }, body: JSON.stringify(profile) })).status).toBe(403);
    expect((await fetch(server.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(profile) })).status).toBe(403);
    expect((await fetch(server.url, { method: "POST", headers: { Origin: url.origin, "Content-Type": "text/plain" }, body: JSON.stringify(profile) })).status).toBe(403);
    expect((await fetch(server.url, { method: "POST", headers: { Host: "attacker.example", Origin: url.origin, "Content-Type": "application/json" }, body: JSON.stringify(profile) })).status).toBe(404);
    expect(existsSync(file)).toBe(false);
    const invalid = await fetch(server.url, { method: "POST", headers: { Origin: url.origin, "Content-Type": "application/json" }, body: JSON.stringify({ ...profile, privateKeyPem: "secret-malformed" }) });
    expect(invalid.status).toBe(400);
    expect(await invalid.text()).not.toContain("secret-malformed");
    const saved = await fetch(server.url, { method: "POST", headers: { Origin: url.origin, "Content-Type": "application/json" }, body: JSON.stringify(profile) });
    expect(saved.status).toBe(200);
    expect(await saved.text()).not.toContain(profile.apiId);
    expect(loadCredentials(file)?.environment).toBe("demo");
    expect((await fetch(server.url)).status).toBe(410);
  });
});
