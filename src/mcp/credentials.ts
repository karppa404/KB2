import { createPrivateKey, randomBytes } from "node:crypto";
import { type Stats, constants, closeSync, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const KALSHI_BASE_URLS = {
  production: "https://external-api.kalshi.com/trade-api/v2",
  demo: "https://external-api.demo.kalshi.co/trade-api/v2",
} as const;
export interface CredentialProfile {
  version: 1;
  apiId: string;
  privateKeyPem: string;
  environment: keyof typeof KALSHI_BASE_URLS;
}

export function credentialPath(): string {
  return resolve(process.env.KALSHI_MCP_CREDENTIALS_PATH ?? join(homedir(), ".config", "kalshi-mcp", "credentials.json"));
}

export function validateCredentials(input: unknown): CredentialProfile {
  if (!input || typeof input !== "object") throw new Error("Invalid credential profile");
  const value = input as Record<string, unknown>;
  if (value.version !== undefined && value.version !== 1) throw new Error("Unsupported credential profile version");
  if (typeof value.apiId !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(value.apiId.trim())) throw new Error("Enter a valid Kalshi API key ID");
  if (value.environment !== "production" && value.environment !== "demo") throw new Error("Select production or demo");
  if (typeof value.privateKeyPem !== "string" || value.privateKeyPem.length > 32_768) throw new Error("Select a PEM private key file");
  try {
    const key = createPrivateKey(value.privateKeyPem);
    if (key.asymmetricKeyType !== "ed25519" && !(key.asymmetricKeyType === "rsa" && (key.asymmetricKeyDetails?.modulusLength ?? 0) >= 2048)) throw new Error();
    return { version: 1, apiId: value.apiId.trim(), privateKeyPem: key.export({ format: "pem", type: "pkcs8" }).toString(), environment: value.environment };
  } catch { throw new Error("Use an unencrypted Ed25519 or RSA (at least 2048-bit) private key PEM file"); }
}

function checkPrivate(stat: Stats, directory: boolean): void {
  if (process.platform === "win32") throw new Error("Credential files require POSIX owner-only permissions; use managed environment credentials on Windows");
  if ((directory ? !stat.isDirectory() : !stat.isFile()) || stat.isSymbolicLink()) throw new Error("Credential storage must use a regular file and directory, never symlinks");
  if ((stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid())) throw new Error("Credential storage must be owned by this user with directory mode 0700 and file mode 0600");
}

function checkDirectory(path: string, create = false): void {
  const directory = dirname(resolve(path));
  if (create) mkdirSync(directory, { recursive: true, mode: 0o700 });
  checkPrivate(lstatSync(directory), true);
}

export function loadCredentials(path = credentialPath()): CredentialProfile | undefined {
  if (!existsSync(dirname(path))) return undefined;
  checkDirectory(path);
  let fd: number;
  try { fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw new Error("Cannot safely open credential file"); }
  try {
    const stat = fstatSync(fd);
    checkPrivate(stat, false);
    if (stat.size > 40_000) throw new Error("Credential file is too large");
    try { return validateCredentials(JSON.parse(readFileSync(fd, "utf8"))); }
    catch { throw new Error("Invalid credential file; run setup to replace it"); }
  } finally { closeSync(fd); }
}

export function saveCredentials(input: unknown, path = credentialPath()): void {
  const profile = validateCredentials(input);
  checkDirectory(path, true);
  try { checkPrivate(lstatSync(path), false); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const temporary = `${path}.${randomBytes(16).toString("hex")}.tmp`;
  let fd: number | undefined;
  try {
    fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    writeFileSync(fd, JSON.stringify(profile));
    fsyncSync(fd);
    closeSync(fd); fd = undefined;
    renameSync(temporary, path);
  } finally {
    if (fd !== undefined) closeSync(fd);
    try { unlinkSync(temporary); } catch { /* Already atomically moved or never created. */ }
  }
}

export function removeCredentials(path = credentialPath()): boolean {
  if (!existsSync(dirname(path))) return false;
  checkDirectory(path);
  try { checkPrivate(lstatSync(path), false); unlinkSync(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}

export function credentialStatus(path = credentialPath()) {
  const profile = loadCredentials(path);
  return { configured: !!profile, environment: profile?.environment, path, storage: "owner-only local file; not encrypted" };
}

export function applyCredentialEnvironment(profile: CredentialProfile): void {
  process.env.KALSHI_API_ID = profile.apiId;
  process.env.KALSHI_PRIVATE_KEY_PEM = profile.privateKeyPem;
  delete process.env.KALSHI_PRIVATE_KEY;
  process.env.KALSHI_BASE_URL = KALSHI_BASE_URLS[profile.environment];
}
