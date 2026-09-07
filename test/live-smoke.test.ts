/**
 * Live smoke tests — hit the real upstream endpoint.
 * Skipped unless RUN_LIVE=1 is set, so CI / `npm test` stays hermetic.
 *
 * Usage:
 *   RUN_LIVE=1 npm run test:live
 */
import { describe, it, expect } from "vitest";

const SKIP = process.env["RUN_LIVE"] !== "1";
const UPSTREAM = "https://insurance-webhook-945894769129.us-central1.run.app";

describe.skipIf(SKIP)("live smoke tests (RUN_LIVE=1)", () => {
  it("returns vehicle data for a known 8-digit plate", async () => {
    const response = await fetch(`${UPSTREAM}/vehicle-info`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ license_plate: "12345678" }),
      signal: AbortSignal.timeout(10_000),
    });
    expect(response.status).toBe(200);
    const body = await response.json() as unknown;
    expect(body).toMatchObject({
      success: true,
      data: {
        license_plate: "12345678",
        manufacturer: expect.any(String),
        model: expect.any(String),
        year: expect.any(Number),
        color: expect.any(String),
      },
    });
  });

  it("returns 404 for an unknown plate", async () => {
    const response = await fetch(`${UPSTREAM}/vehicle-info`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ license_plate: "9999999" }),
      signal: AbortSignal.timeout(10_000),
    });
    expect(response.status).toBe(404);
    const body = await response.json() as { detail?: { success: boolean } };
    expect(body?.detail?.success).toBe(false);
  });

  it("returns 422 for an invalid plate format", async () => {
    const response = await fetch(`${UPSTREAM}/vehicle-info`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ license_plate: "ABC1234" }),
      signal: AbortSignal.timeout(10_000),
    });
    expect(response.status).toBe(422);
  });
});
