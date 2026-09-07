import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AppError } from "../src/errors.js";

// Mock config before importing vehicle-service
vi.mock("../src/config.js", () => ({
  config: {
    upstreamBaseUrl: "https://example.com",
    upstreamTimeoutMs: 3000,
    upstreamMaxRetries: 2,
    logLevel: "error",
  },
}));

// Import after mocking config
const { lookupVehicle } = await import("../src/vehicle-service.js");

const VALID_VEHICLE_DATA = {
  license_plate: "12345678",
  manufacturer: "Toyota",
  model: "Corolla",
  year: 2020,
  color: "White",
};

const SUCCESS_BODY = { success: true, data: VALID_VEHICLE_DATA };

function mockFetch(
  responses: Array<{ status: number; body: unknown } | { throws: Error }>
): void {
  let callCount = 0;
  global.fetch = vi.fn(async () => {
    const resp = responses[callCount];
    if (!resp) throw new Error("fetch called more times than expected");
    callCount++;

    if ("throws" in resp) throw resp.throws;

    return {
      ok: resp.status >= 200 && resp.status < 300,
      status: resp.status,
      json: async () => resp.body,
    } as Response;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("lookupVehicle", () => {
  describe("success path", () => {
    it("returns VehicleData on upstream 200", async () => {
      mockFetch([{ status: 200, body: SUCCESS_BODY }]);
      const result = await lookupVehicle("12345678");
      expect(result).toEqual(VALID_VEHICLE_DATA);
      expect(global.fetch).toHaveBeenCalledOnce();
    });

    it("sends the correct request to upstream", async () => {
      mockFetch([{ status: 200, body: SUCCESS_BODY }]);
      await lookupVehicle("12345678", "req-123");
      expect(global.fetch).toHaveBeenCalledWith(
        "https://example.com/vehicle-info",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ license_plate: "12345678" }),
          headers: { "Content-Type": "application/json" },
        })
      );
    });
  });

  describe("not-found path", () => {
    it("throws NOT_FOUND AppError on upstream 404", async () => {
      mockFetch([
        {
          status: 404,
          body: { detail: { success: false, error: "Vehicle not found" } },
        },
      ]);
      await expect(lookupVehicle("9999999")).rejects.toMatchObject({
        code: "NOT_FOUND",
        httpStatus: 404,
      });
    });

    it("does not retry on 404", async () => {
      mockFetch([
        {
          status: 404,
          body: { detail: { success: false, error: "Vehicle not found" } },
        },
      ]);
      await expect(lookupVehicle("9999999")).rejects.toThrow(AppError);
      expect(global.fetch).toHaveBeenCalledOnce();
    });
  });

  describe("upstream 422 (defensive)", () => {
    it("throws VALIDATION_ERROR and does not retry on upstream 422", async () => {
      mockFetch([
        {
          status: 422,
          body: {
            detail: [{ type: "value_error", msg: "invalid plate", loc: ["body", "license_plate"] }],
          },
        },
      ]);
      await expect(lookupVehicle("badplate")).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        httpStatus: 400,
      });
      expect(global.fetch).toHaveBeenCalledOnce();
    });
  });

  describe("retry behaviour on 5xx", () => {
    it("retries on 500 and succeeds when retry returns 200", async () => {
      mockFetch([
        { status: 500, body: { error: "internal" } },
        { status: 200, body: SUCCESS_BODY },
      ]);
      const result = await lookupVehicle("12345678");
      expect(result).toEqual(VALID_VEHICLE_DATA);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it("exhausts retries and throws BAD_GATEWAY after all 500s", async () => {
      // maxRetries=2 → 3 total attempts
      mockFetch([
        { status: 500, body: {} },
        { status: 500, body: {} },
        { status: 500, body: {} },
      ]);
      await expect(lookupVehicle("12345678")).rejects.toMatchObject({
        code: "BAD_GATEWAY",
        httpStatus: 502,
      });
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });

    it("throws BAD_GATEWAY on 503", async () => {
      mockFetch([
        { status: 503, body: {} },
        { status: 503, body: {} },
        { status: 503, body: {} },
      ]);
      await expect(lookupVehicle("12345678")).rejects.toMatchObject({
        code: "BAD_GATEWAY",
      });
    });
  });

  describe("timeout handling", () => {
    it("retries on TimeoutError and throws BAD_GATEWAY after all timeouts", async () => {
      const timeoutError = new Error("The operation was aborted due to timeout");
      timeoutError.name = "TimeoutError";

      mockFetch([
        { throws: timeoutError },
        { throws: timeoutError },
        { throws: timeoutError },
      ]);

      await expect(lookupVehicle("12345678")).rejects.toMatchObject({
        code: "BAD_GATEWAY",
        httpStatus: 502,
      });
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });

    it("succeeds after a single timeout then a 200", async () => {
      const timeoutError = new Error("timeout");
      timeoutError.name = "TimeoutError";

      mockFetch([
        { throws: timeoutError },
        { status: 200, body: SUCCESS_BODY },
      ]);

      const result = await lookupVehicle("12345678");
      expect(result).toEqual(VALID_VEHICLE_DATA);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe("malformed upstream body", () => {
    it("throws BAD_GATEWAY when upstream 200 body fails schema validation", async () => {
      mockFetch([{ status: 200, body: { success: true, data: { incomplete: true } } }]);
      await expect(lookupVehicle("12345678")).rejects.toMatchObject({
        code: "BAD_GATEWAY",
      });
    });

    it("throws BAD_GATEWAY when upstream returns non-JSON", async () => {
      global.fetch = vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => { throw new SyntaxError("Unexpected token"); },
      } as unknown as Response));

      await expect(lookupVehicle("12345678")).rejects.toMatchObject({
        code: "BAD_GATEWAY",
      });
    });
  });
});
