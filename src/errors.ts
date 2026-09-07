export type ErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "BAD_GATEWAY"
  | "INTERNAL_ERROR";

const HTTP_STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  BAD_GATEWAY: 502,
  INTERNAL_ERROR: 500,
};

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly httpStatus: number;
  public readonly field?: string;

  constructor(code: ErrorCode, message: string, field?: string) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.httpStatus = HTTP_STATUS[code];
    this.field = field;
  }
}

/** Serialise an AppError into an API Gateway-compatible response object. */
export function toHttpResponse(err: AppError): {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
} {
  const body: Record<string, unknown> = {
    success: false,
    error: {
      code: err.code,
      message: err.message,
      ...(err.field !== undefined && { field: err.field }),
    },
  };
  return {
    statusCode: err.httpStatus,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
