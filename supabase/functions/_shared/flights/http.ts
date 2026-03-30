export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function toHttpError(error: unknown) {
  return error instanceof HttpError ? error : new HttpError(
    500,
    error instanceof Error ? error.message : "Unknown error",
  );
}
