/**
 * All runtime configuration is injected via environment variables by Terraform.
 * This module loads and validates them at cold-start; bad config fails immediately
 * rather than at request time.
 */

function requireEnv(key: string, defaultValue?: string): string {
  const value = process.env[key] ?? defaultValue;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function parsePositiveInt(raw: string, name: string): number {
  const n = parseInt(raw, 10);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${name} must be a positive integer, got: ${raw}`);
  }
  return n;
}

export const config = {
  upstreamBaseUrl: requireEnv(
    "UPSTREAM_BASE_URL",
    "https://insurance-webhook-945894769129.us-central1.run.app"
  ).replace(/\/$/, ""), // strip trailing slash for safe URL construction

  upstreamTimeoutMs: parsePositiveInt(
    requireEnv("UPSTREAM_TIMEOUT_MS", "5000"),
    "UPSTREAM_TIMEOUT_MS"
  ),

  upstreamMaxRetries: parsePositiveInt(
    requireEnv("UPSTREAM_MAX_RETRIES", "2"),
    "UPSTREAM_MAX_RETRIES"
  ),

  logLevel: requireEnv("LOG_LEVEL", "info"),

  apiKey: requireEnv("API_KEY"),
} as const;

// Log non-sensitive config at cold-start so a deploy can be verified immediately.
console.info(
  JSON.stringify({
    level: "info",
    msg: "config loaded",
    upstreamBaseUrl: config.upstreamBaseUrl,
    upstreamTimeoutMs: config.upstreamTimeoutMs,
    upstreamMaxRetries: config.upstreamMaxRetries,
    logLevel: config.logLevel,
    apiKeySuffix: `...${config.apiKey.slice(-4)}`,
  })
);
