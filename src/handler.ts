import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { config } from "./config.js";
import { AppError, toHttpResponse } from "./errors.js";
import { VehicleRequestSchema } from "./schema.js";
import { lookupVehicle } from "./vehicle-service.js";

/** Structured log helper — Lambda captures stdout to CloudWatch. */
function log(
  level: "info" | "warn" | "error",
  data: Record<string, unknown>
): void {
  console[level](JSON.stringify({ level, ...data }));
}

const JSON_HEADERS = { "Content-Type": "application/json" };

// Module-level flag: true only on the first invocation of this execution environment.
let isColdStart = true;

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  const requestId = event.requestContext?.requestId ?? "-";
  const startMs = Date.now();
  const coldStart = isColdStart;
  isColdStart = false;

  // Redact the API key value so it never appears in logs.
  const logHeaders = Object.fromEntries(
    Object.entries(event.headers ?? {}).map(([k, v]) =>
      [k, k === "x-api-key" ? `...${v?.slice(-4) ?? ""}` : v]
    )
  );

  log("info", {
    requestId,
    msg: "request received",
    route: event.requestContext?.http?.method + " " + event.requestContext?.http?.path,
    sourceIp: event.requestContext?.http?.sourceIp,
    bodySize: event.body?.length ?? 0,
    coldStart,
    headers: logHeaders,
  });

  // --- Authenticate ---
  const providedKey = event.headers?.["x-api-key"];
  if (!providedKey || providedKey !== config.apiKey) {
    log("warn", { requestId, msg: "unauthorized request", latencyMs: Date.now() - startMs });
    return {
      statusCode: 401,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        success: false,
        error: { code: "UNAUTHORIZED", message: "Invalid or missing API key" },
      }),
    };
  }

  // plate is declared here so it's accessible in the catch block for error logs.
  let plate: string | undefined;

  try {
    // --- Parse request body ---
    let rawBody: unknown;
    try {
      rawBody = JSON.parse(event.body ?? "{}");
    } catch {
      log("warn", {
        requestId,
        msg: "invalid JSON body",
        latencyMs: Date.now() - startMs,
      });
      return {
        statusCode: 400,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          success: false,
          error: { code: "VALIDATION_ERROR", message: "Request body must be valid JSON" },
        }),
      };
    }

    // --- Validate input ---
    const parsed = VehicleRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const field = issue?.path[0]?.toString() ?? "license_plate";
      const message = issue?.message ?? "Invalid request";

      log("info", {
        requestId,
        msg: "validation error",
        field,
        message,
        latencyMs: Date.now() - startMs,
      });

      return {
        statusCode: 400,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          success: false,
          error: { code: "VALIDATION_ERROR", field, message },
        }),
      };
    }

    plate = parsed.data.license_plate;

    // --- Call upstream ---
    const data = await lookupVehicle(plate, requestId);

    log("info", {
      requestId,
      msg: "request completed",
      statusCode: 200,
      plate,
      latencyMs: Date.now() - startMs,
    });

    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({ success: true, data }),
    };
  } catch (err) {
    const latencyMs = Date.now() - startMs;

    if (err instanceof AppError) {
      log(err.code === "NOT_FOUND" ? "info" : "warn", {
        requestId,
        msg: "request completed",
        statusCode: err.httpStatus,
        code: err.code,
        plate,
        latencyMs,
      });
      return toHttpResponse(err);
    }

    // Unexpected error — never expose internals
    log("error", {
      requestId,
      msg: "unhandled error",
      error: err instanceof Error ? err.message : String(err),
      plate,
      statusCode: 500,
      latencyMs,
    });

    return {
      statusCode: 500,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        success: false,
        error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      }),
    };
  }
};
