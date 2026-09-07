import { config } from "./config.js";
import { AppError } from "./errors.js";
import {
  UpstreamSuccessSchema,
  UpstreamNotFoundSchema,
  type VehicleData,
} from "./schema.js";

/** Structured log entry emitted to stdout → CloudWatch. */
function log(
  level: "info" | "warn" | "error",
  data: Record<string, unknown>
): void {
  console[level](JSON.stringify({ level, ...data }));
}

/**
 * Exponential backoff with full jitter.
 * attempt is 0-indexed (first retry = attempt 1).
 */
function backoffMs(attempt: number, baseMs = 200, capMs = 5000): number {
  const exponential = Math.min(capMs, baseMs * 2 ** attempt);
  return Math.floor(Math.random() * exponential);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Returns true for HTTP status codes that are worth retrying. */
function isTransient(status: number): boolean {
  return status >= 500;
}

/**
 * Look up a vehicle by license plate via the upstream API.
 * Retries transient failures (5xx, timeout) up to config.upstreamMaxRetries times.
 * Deterministic failures (404, 422) are thrown immediately without retry.
 *
 * @throws {AppError} with code NOT_FOUND, BAD_GATEWAY, or VALIDATION_ERROR
 */
export async function lookupVehicle(
  plate: string,
  requestId: string = "-"
): Promise<VehicleData> {
  const url = `${config.upstreamBaseUrl}/vehicle-info`;
  const maxAttempts = config.upstreamMaxRetries + 1;

  let lastError: AppError | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      const delay = backoffMs(attempt - 1);
      log("warn", {
        requestId,
        msg: "retrying upstream call",
        attempt,
        delayMs: delay,
        plate,
      });
      await sleep(delay);
    }

    const startMs = Date.now();
    let upstreamStatus: number | null = null;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ license_plate: plate }),
        signal: AbortSignal.timeout(config.upstreamTimeoutMs),
      });

      upstreamStatus = response.status;
      const latencyMs = Date.now() - startMs;

      // --- Parse body safely ---
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        log("error", {
          requestId,
          msg: "upstream returned non-JSON body",
          upstreamStatus,
          latencyMs,
          plate,
        });
        // Non-JSON from upstream is not retryable — malformed response
        throw new AppError("BAD_GATEWAY", "Upstream returned an invalid response");
      }

      // --- Route by status ---
      if (response.ok) {
        const parsed = UpstreamSuccessSchema.safeParse(body);
        if (!parsed.success) {
          log("error", {
            requestId,
            msg: "upstream 200 body failed schema validation",
            upstreamStatus,
            latencyMs,
            plate,
            issues: parsed.error.issues,
          });
          throw new AppError("BAD_GATEWAY", "Upstream returned an unexpected response shape");
        }
        log("info", {
          requestId,
          msg: "upstream success",
          upstreamStatus,
          latencyMs,
          plate,
          attempt,          // >0 means this succeeded after retries
        });
        return parsed.data.data;
      }

      if (response.status === 404) {
        log("info", {
          requestId,
          msg: "vehicle not found",
          upstreamStatus,
          latencyMs,
          plate,
        });
        // Deterministic — do not retry
        throw new AppError("NOT_FOUND", "Vehicle not found");
      }

      if (response.status === 422) {
        // Shouldn't happen when our validation is correct, but handle defensively
        log("warn", {
          requestId,
          msg: "upstream returned 422 (validation mismatch)",
          upstreamStatus,
          latencyMs,
          plate,
        });
        // Deterministic — do not retry
        throw new AppError("VALIDATION_ERROR", "Invalid license plate format");
      }

      // 5xx or other unexpected status — transient, eligible for retry
      log("warn", {
        requestId,
        msg: "upstream returned transient error",
        upstreamStatus,
        latencyMs,
        plate,
        attempt,
      });
      lastError = new AppError("BAD_GATEWAY", "Upstream service temporarily unavailable");

      if (!isTransient(response.status)) {
        // Unknown 4xx — deterministic, do not retry
        throw lastError;
      }

    } catch (err) {
      const latencyMs = Date.now() - startMs;

      if (err instanceof AppError) {
        // NOT_FOUND and VALIDATION_ERROR: deterministic, bubble immediately
        if (err.code === "NOT_FOUND" || err.code === "VALIDATION_ERROR") {
          throw err;
        }
        // BAD_GATEWAY from non-JSON or schema mismatch — do not retry
        if (err.code === "BAD_GATEWAY" && upstreamStatus !== null && !isTransient(upstreamStatus)) {
          throw err;
        }
        lastError = err;
        continue;
      }

      // AbortError = timeout
      if (err instanceof Error && err.name === "TimeoutError") {
        log("warn", {
          requestId,
          msg: "upstream request timed out",
          latencyMs,
          plate,
          attempt,
          timeoutMs: config.upstreamTimeoutMs,
        });
        lastError = new AppError("BAD_GATEWAY", "Upstream request timed out");
        continue;
      }

      // Network-level error (DNS, connection refused, etc.)
      log("error", {
        requestId,
        msg: "upstream network error",
        error: err instanceof Error ? err.message : String(err),
        latencyMs,
        plate,
        attempt,
      });
      lastError = new AppError("BAD_GATEWAY", "Upstream service unreachable");
    }
  }

  throw lastError ?? new AppError("BAD_GATEWAY", "Upstream service unavailable");
}
