import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
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

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  const requestId = event.requestContext?.requestId ?? "-";
  const startMs = Date.now();

  log("info", {
    requestId,
    route: event.requestContext?.http?.method + " " + event.requestContext?.http?.path,
    msg: "request received",
  });

  try {
    // --- Parse request body ---
    let rawBody: unknown;
    try {
      rawBody = JSON.parse(event.body ?? "{}");
    } catch {
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

    const { license_plate } = parsed.data;

    // --- Call upstream ---
    const data = await lookupVehicle(license_plate, requestId);

    log("info", {
      requestId,
      msg: "request completed",
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
        msg: "handled error",
        code: err.code,
        latencyMs,
      });
      return toHttpResponse(err);
    }

    // Unexpected error — never expose internals
    log("error", {
      requestId,
      msg: "unhandled error",
      error: err instanceof Error ? err.message : String(err),
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
