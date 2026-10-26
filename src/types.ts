type BuiltIn =
  | Date
  | RegExp
  | Error
  | Promise<unknown>
  | Map<unknown, unknown>
  | Set<unknown>
  | WeakMap<object, unknown>
  | WeakSet<object>;

/**
 * Recursively flatten a type so editors show its full structure on hover
 * instead of an opaque alias like `Pick<Omit<User, "x">, "y"> & Extra`.
 *
 * Built-ins and functions are left untouched. Purely cosmetic: the result is
 * structurally identical to the input.
 */
export type DeepPrettify<T> = T extends BuiltIn
  ? T
  : T extends (...args: never[]) => unknown
    ? T
    : T extends readonly (infer U)[]
      ? T extends unknown[]
        ? DeepPrettify<U>[]
        : readonly DeepPrettify<U>[]
      : T extends object
        ? { [K in keyof T]: DeepPrettify<T[K]> }
        : T;
