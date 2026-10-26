import { RequestError } from "./normalize-error";
import type { DeepPrettify } from "./types";

/** `{ data: D }` → `D` when unwrapping is on; anything else passes through. */
export type Unwrapped<TResponse, TUnwrap extends boolean = true> = TUnwrap extends true
  ? TResponse extends { data: infer D }
    ? D
    : TResponse
  : TResponse;

export interface WrapRequestOptions<TData, TResult, TUnwrap extends boolean> {
  /** Shape the (unwrapped) payload, typically a DTO factory's `single` or `list`. */
  transform?: (data: TData) => TResult;
  /**
   * Return `response.data` instead of `response` when it exists (axios-style).
   * Turn it off when the payload itself has a meaningful `data` field.
   * Defaults to `true`.
   */
  unwrapData?: TUnwrap;
  /** Map any thrown value before rejecting. Defaults to `RequestError.from`. */
  mapError?: (error: unknown) => unknown;
}

const isObjectWithData = (value: unknown): value is { data: unknown } =>
  typeof value === "object" && value !== null && Object.prototype.hasOwnProperty.call(value, "data");

/**
 * Wrap a request function so every call:
 *   - unwraps `response.data` (configurable),
 *   - runs the payload through a transform (e.g. a DTO factory),
 *   - rejects with one predictable error type.
 *
 * Works with axios, fetch helpers, or any function returning a promise.
 *
 * @example
 * const getUser = wrapRequest((id: string) => http.get<RawUser>(`/users/${id}`), {
 *   transform: userDto.single,
 * });
 * const user = await getUser("42"); // User
 */
export function wrapRequest<
  TArgs extends unknown[],
  TResponse,
  TUnwrap extends boolean = true,
  TResult = Unwrapped<TResponse, TUnwrap>,
>(
  request: (...args: TArgs) => Promise<TResponse>,
  options: WrapRequestOptions<Unwrapped<TResponse, TUnwrap>, TResult, TUnwrap> = {},
): (...args: TArgs) => Promise<DeepPrettify<TResult>> {
  const { transform, unwrapData = true, mapError = RequestError.from } = options;

  return async (...args: TArgs) => {
    try {
      const response = await request(...args);
      const payload = (unwrapData && isObjectWithData(response) ? response.data : response) as Unwrapped<
        TResponse,
        TUnwrap
      >;
      const result = transform ? transform(payload) : payload;
      return result as DeepPrettify<TResult>;
    } catch (error) {
      throw mapError(error);
    }
  };
}
