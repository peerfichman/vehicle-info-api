import { describe, it, expect } from "vitest";
import { VehicleRequestSchema } from "../src/schema.js";

describe("VehicleRequestSchema", () => {
  describe("valid plates", () => {
    it("accepts a valid 8-digit plate", () => {
      const result = VehicleRequestSchema.safeParse({ license_plate: "12345678" });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.license_plate).toBe("12345678");
    });

    it("accepts a valid 7-digit plate", () => {
      const result = VehicleRequestSchema.safeParse({ license_plate: "1234567" });
      expect(result.success).toBe(true);
    });

    it("trims surrounding whitespace before validation", () => {
      const result = VehicleRequestSchema.safeParse({ license_plate: "  12345678  " });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.license_plate).toBe("12345678");
    });

    it("trims and accepts 7-digit plate with spaces", () => {
      const result = VehicleRequestSchema.safeParse({ license_plate: " 1234567 " });
      expect(result.success).toBe(true);
    });
  });

  describe("invalid plates", () => {
    it("rejects a plate with letters", () => {
      const result = VehicleRequestSchema.safeParse({ license_plate: "ABC1234" });
      expect(result.success).toBe(false);
    });

    it("rejects a 6-digit plate (too short)", () => {
      const result = VehicleRequestSchema.safeParse({ license_plate: "123456" });
      expect(result.success).toBe(false);
    });

    it("rejects a 9-digit plate (too long)", () => {
      const result = VehicleRequestSchema.safeParse({ license_plate: "123456789" });
      expect(result.success).toBe(false);
    });

    it("rejects an empty string", () => {
      const result = VehicleRequestSchema.safeParse({ license_plate: "" });
      expect(result.success).toBe(false);
    });

    it("rejects whitespace-only input", () => {
      const result = VehicleRequestSchema.safeParse({ license_plate: "   " });
      expect(result.success).toBe(false);
    });

    it("rejects mixed alphanumeric plate", () => {
      const result = VehicleRequestSchema.safeParse({ license_plate: "1234ABC8" });
      expect(result.success).toBe(false);
    });
  });

  describe("missing or wrong-type field", () => {
    it("rejects missing license_plate", () => {
      const result = VehicleRequestSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it("rejects null license_plate", () => {
      const result = VehicleRequestSchema.safeParse({ license_plate: null });
      expect(result.success).toBe(false);
    });

    it("rejects numeric license_plate (wrong type)", () => {
      const result = VehicleRequestSchema.safeParse({ license_plate: 12345678 });
      expect(result.success).toBe(false);
    });
  });
});
