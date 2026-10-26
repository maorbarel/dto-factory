type Bag = Record<string, unknown>;

const asBag = (value: unknown): Bag | undefined =>
  typeof value === "object" && value !== null ? (value as Bag) : undefined;

const nonEmptyString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value : undefined;

/**
 * Extract a human-readable message from anything that was thrown.
 *
 * Checked in order — the server's own message beats the transport's generic one:
 *   1. `error.response.data.message` / `.error`  (axios-style HTTP errors)
 *   2. `error.data.message` / `.error`           (fetch wrappers, ofetch, ky)
 *   3. `error.message`                           (any Error)
 *   4. the error itself, when it is a string
 *   5. `fallback`
 */
export const normalizeError = (error: unknown, fallback = "Unknown error"): string => {
  const err = asBag(error);
  if (!err) return nonEmptyString(error) ?? fallback;

  const responseData = asBag(asBag(err.response)?.data);
  const data = asBag(err.data);

  return (
    nonEmptyString(responseData?.message) ??
    nonEmptyString(responseData?.error) ??
    nonEmptyString(data?.message) ??
    nonEmptyString(data?.error) ??
    nonEmptyString(err.message) ??
    fallback
  );
};

/** Best-effort HTTP status from axios-style or fetch-style errors. */
export const extractStatus = (error: unknown): number | undefined => {
  const err = asBag(error);
  const status = asBag(err?.response)?.status ?? err?.status ?? err?.statusCode;
  return typeof status === "number" ? status : undefined;
};

/** The single error type `wrapRequest` rejects with by default. */
export class RequestError extends Error {
  override readonly name = "RequestError";
  readonly status: number | undefined;

  constructor(message: string, options: { cause?: unknown; status?: number } = {}) {
    super(message, { cause: options.cause });
    this.status = options.status;
  }

  static from(error: unknown): RequestError {
    if (error instanceof RequestError) return error;
    return new RequestError(normalizeError(error), { cause: error, status: extractStatus(error) });
  }
}
