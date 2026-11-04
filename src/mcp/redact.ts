const sensitiveKey = /authorization|api[_-]?(key|id)|private[_-]?key|password|secret|access[_-]?token|refresh[_-]?token/i;

export function redact(value: unknown): unknown {
  if (typeof value === "string") {
    let clean = value.replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, "[REDACTED]");
    for (const key of ["KALSHI_API_ID", "KALSHI_PRIVATE_KEY", "KALSHI_PRIVATE_KEY_PEM"]) {
      const secret = process.env[key];
      if (secret) clean = clean.split(secret).join("[REDACTED]");
    }
    return clean;
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sensitiveKey.test(key) ? "[REDACTED]" : redact(item)]));
  return value;
}
