import { z } from "zod";

/** Incoming request to our API. */
export const VehicleRequestSchema = z.object({
  license_plate: z
    .string({ required_error: "license_plate is required" })
    .trim()
    .regex(/^\d{7,8}$/, "license_plate must be 7 or 8 digits"),
});

export type VehicleRequest = z.infer<typeof VehicleRequestSchema>;

/** Vehicle data returned by the upstream on success. */
export const VehicleDataSchema = z.object({
  license_plate: z.string(),
  manufacturer: z.string(),
  model: z.string(),
  year: z.number().int(),
  color: z.string(),
});

export type VehicleData = z.infer<typeof VehicleDataSchema>;

/** Upstream success envelope (HTTP 200). */
export const UpstreamSuccessSchema = z.object({
  success: z.literal(true),
  data: VehicleDataSchema,
});

/**
 * Upstream 404 body.
 * The live API wraps the error under `detail` (FastAPI HTTPException behaviour),
 * despite the OpenAPI spec showing a bare ErrorResponse.
 */
export const UpstreamNotFoundSchema = z.object({
  detail: z.object({
    success: z.literal(false),
    error: z.string(),
  }),
});

/** Our stable success envelope. */
export const ApiSuccessSchema = z.object({
  success: z.literal(true),
  data: VehicleDataSchema,
});

export type ApiSuccess = z.infer<typeof ApiSuccessSchema>;

/** Our stable error envelope. */
export const ApiErrorSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    field: z.string().optional(),
  }),
});

export type ApiError = z.infer<typeof ApiErrorSchema>;
