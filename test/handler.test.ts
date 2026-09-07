import { describe, it, expect, vi, beforeEach } from "vitest";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { AppError } from "../src/errors.js";

// Mock config before importing handler
vi.mock("../src/config.js", () => ({
  config: {
    upstreamBaseUrl: "https://example.com",
    upstreamTimeoutMs: 3000,
    upstreamMaxRetries: 2,
    logLevel: "error",
  },
}));

// Mock vehicle-service so handler tests are pure unit tests
vi.mock("../src/vehicle-service.js", () => ({
  lookupVehicle: vi.fn(),
}));

const { handler } = await import("../src/handler.js");
const { lookupVehicle } = await import("../src/vehicle-service.js");
const mockLookup = vi.mocked(lookupVehicle);

const VALID_DATA = {
  license_plate: "12345678",
  manufacturer: "Toyota",
  model: "Corolla",
  year: 2020,
  color: "White",
};

/** Minimal APIGW HTTP API v2 proxy event. */
function makeEvent(body: unknown): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: "POST /vehicle-info",
    rawPath: "/vehicle-info",
    rawQueryString: "",
    headers: { "content-type": "application/json" },
    requestContext: {
      accountId: "123456789012",
      apiId: "test",
      domainName: "test.execute-api.us-east-1.amazonaws.com",
      domainPrefix: "test",
      http: {
        method: "POST",
        path: "/vehicle-info",
        protocol: "HTTP/1.1",
        sourceIp: "1.2.3.4",
        userAgent: "test",
      },
      requestId: "test-request-id",
      routeKey: "POST /vehicle-info",
      stage: "$default",
      time: "01/Jan/2024:00:00:00 +0000",
      timeEpoch: 1704067200000,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
    isBase64Encoded: false,
  } as APIGatewayProxyEventV2;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handler", () => {
  describe("happy path", () => {
    it("returns 200 with success envelope for valid plate", async () => {
      mockLookup.mockResolvedValueOnce(VALID_DATA);
      const event = makeEvent({ license_plate: "12345678" });
      const result = await handler(event);

      expect(result).toMatchObject({ statusCode: 200 });
      const body = JSON.parse((result as { body: string }).body);
      expect(body).toEqual({ success: true, data: VALID_DATA });
    });

    it("passes trimmed plate to lookupVehicle", async () => {
      mockLookup.mockResolvedValueOnce(VALID_DATA);
      await handler(makeEvent({ license_plate: "  12345678  " }));
      expect(mockLookup).toHaveBeenCalledWith("12345678", expect.any(String));
    });
  });

  describe("validation errors → 400", () => {
    it("returns 400 for missing license_plate", async () => {
      const result = await handler(makeEvent({}));
      expect(result).toMatchObject({ statusCode: 400 });
      const body = JSON.parse((result as { body: string }).body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 for plate with letters", async () => {
      const result = await handler(makeEvent({ license_plate: "ABC1234" }));
      expect(result).toMatchObject({ statusCode: 400 });
      const body = JSON.parse((result as { body: string }).body);
      expect(body.error.code).toBe("VALIDATION_ERROR");
      expect(body.error.field).toBe("license_plate");
    });

    it("returns 400 for 6-digit plate", async () => {
      const result = await handler(makeEvent({ license_plate: "123456" }));
      expect(result).toMatchObject({ statusCode: 400 });
    });

    it("returns 400 for empty string plate", async () => {
      const result = await handler(makeEvent({ license_plate: "" }));
      expect(result).toMatchObject({ statusCode: 400 });
    });

    it("returns 400 for invalid JSON body", async () => {
      const event = makeEvent("not-json");
      const result = await handler(event);
      expect(result).toMatchObject({ statusCode: 400 });
      const body = JSON.parse((result as { body: string }).body);
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });

    it("does not call lookupVehicle when validation fails", async () => {
      await handler(makeEvent({ license_plate: "bad" }));
      expect(mockLookup).not.toHaveBeenCalled();
    });
  });

  describe("not found → 404", () => {
    it("returns 404 when service throws NOT_FOUND", async () => {
      mockLookup.mockRejectedValueOnce(new AppError("NOT_FOUND", "Vehicle not found"));
      const result = await handler(makeEvent({ license_plate: "9999999" }));
      expect(result).toMatchObject({ statusCode: 404 });
      const body = JSON.parse((result as { body: string }).body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("NOT_FOUND");
    });
  });

  describe("upstream failures → 502", () => {
    it("returns 502 when service throws BAD_GATEWAY", async () => {
      mockLookup.mockRejectedValueOnce(
        new AppError("BAD_GATEWAY", "Upstream unavailable")
      );
      const result = await handler(makeEvent({ license_plate: "12345678" }));
      expect(result).toMatchObject({ statusCode: 502 });
      const body = JSON.parse((result as { body: string }).body);
      expect(body.error.code).toBe("BAD_GATEWAY");
    });
  });

  describe("unexpected errors → 500", () => {
    it("returns 500 without stack trace for unhandled exceptions", async () => {
      mockLookup.mockRejectedValueOnce(new Error("something blew up"));
      const result = await handler(makeEvent({ license_plate: "12345678" }));
      expect(result).toMatchObject({ statusCode: 500 });
      const body = JSON.parse((result as { body: string }).body);
      expect(body.error.code).toBe("INTERNAL_ERROR");
      // Never expose internal error details
      expect(body.error.message).not.toContain("blew up");
    });
  });

  describe("response shape", () => {
    it("always sets Content-Type: application/json header", async () => {
      mockLookup.mockResolvedValueOnce(VALID_DATA);
      const result = await handler(makeEvent({ license_plate: "12345678" })) as {
        statusCode: number;
        headers: Record<string, string>;
        body: string;
      };
      expect(result.headers["Content-Type"]).toBe("application/json");
    });
  });
});
