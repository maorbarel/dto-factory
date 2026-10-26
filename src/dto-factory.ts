/**
 * The value a transform receives for key `K`: the raw field's type when the raw
 * shape declares it, `unknown` otherwise (e.g. a key filled through `renameKeys`).
 */
type RawValueOf<TRaw, K> = K extends keyof TRaw ? NonNullable<TRaw[K]> : unknown;

/** Per-field shaping, keyed by the field name on the output type. */
export type Transforms<T, TRaw> = {
  [K in keyof T]?: (value: RawValueOf<TRaw, K>) => T[K];
};

/** Fields derived from the whole raw object. They run last and always win. */
export type ComputedFields<T, TRaw> = {
  [K in keyof T]?: (raw: Partial<TRaw>) => T[K];
};

/** Raw key → output key, for fields the source names differently. */
export type RenameKeys<T, TRaw> = {
  [K in keyof TRaw & string]?: keyof T & string;
};

export interface DtoOptions<T, TRaw> {
  /** Shape individual values: parse dates, build nested DTOs, map enums. */
  transforms?: Transforms<T, TRaw>;
  /** Map raw keys onto output keys, e.g. `{ created_at: "createdAt" }`. */
  renameKeys?: RenameKeys<T, TRaw>;
  /** Drop raw keys that have no counterpart in `defaults`. Defaults to `false`. */
  stripUnknown?: boolean;
  /**
   * Derive fields from the whole raw object. Runs after merge, renames and
   * transforms, and runs even when the raw input is `null`/`undefined`.
   * Use it for generated ids, multi-key fallbacks and per-instance defaults.
   */
  compute?: ComputedFields<T, TRaw>;
}

export interface DtoFactory<T, TRaw> {
  /** Shape one raw entity. `null`/`undefined` yields a fresh copy of the defaults. */
  single: (raw?: TRaw | null) => T;
  /** Shape a list of raw entities. `null`/`undefined` yields `[]`. */
  list: (raws?: readonly (TRaw | null | undefined)[] | null) => T[];
  /** The (frozen) defaults the factory was created with. */
  defaults: Readonly<T>;
}

type Bag = Record<string, unknown>;

const hasOwn = (obj: object, key: string): boolean => Object.prototype.hasOwnProperty.call(obj, key);

const isPlainObject = (value: unknown): value is Bag => {
  if (value === null || typeof value !== "object") return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/** One-level copy so instances never share a default array or object. */
const freshContainer = (value: unknown): unknown =>
  Array.isArray(value) ? value.slice() : isPlainObject(value) ? { ...value } : value;

/**
 * Create a typed factory that turns loosely-shaped server data into complete,
 * predictable objects.
 *
 * Every output field is guaranteed to exist: `defaults` must be a complete `T`,
 * so the compiler tells you when a new field is missing a fallback.
 *
 * Pipeline, per entity:
 *   1. start from a copy of `defaults` (arrays/plain objects are copied too)
 *   2. copy raw fields over it, skipping `undefined` and (optionally) unknown keys
 *   3. apply `renameKeys`
 *   4. apply `transforms` to every value that came from the raw input
 *   5. apply `compute`
 *
 * The merge is shallow by design; compose factories for nested shapes.
 */
export const createDtoFactory = <T extends object, TRaw extends object = Partial<T>>(
  defaults: T,
  options: DtoOptions<T, TRaw> = {},
): DtoFactory<T, TRaw> => {
  const { transforms, renameKeys, stripUnknown = false, compute } = options;

  // Spread from an unfrozen template: V8 clones plain objects faster than frozen ones.
  const defaultsBag = { ...defaults } as Bag;
  const frozenDefaults = Object.freeze({ ...defaults });
  const containerKeys = Object.keys(defaultsBag).filter((key) => {
    const value = defaultsBag[key];
    return Array.isArray(value) || isPlainObject(value);
  });
  const renameEntries = renameKeys ? Object.entries(renameKeys as Record<string, string>) : [];
  const renamedSources = renameEntries.length ? new Set(renameEntries.map(([from]) => from)) : undefined;
  const computeEntries = compute ? Object.entries(compute as Record<string, (raw: Bag) => unknown>) : [];

  // Resolve, once, where each transformed field reads its raw value from:
  // the renamed source if there is one, falling back to the same-named key.
  const transformPlan = Object.entries(transforms ?? {}).map(([key, transform]) => ({
    key,
    transform: transform as (value: unknown) => unknown,
    renamedFrom: renameEntries.find(([, to]) => to === key)?.[0],
    direct: !renamedSources?.has(key),
  }));

  const rawValueFor = (source: Bag, step: (typeof transformPlan)[number]): unknown => {
    const renamed =
      step.renamedFrom !== undefined && hasOwn(source, step.renamedFrom)
        ? source[step.renamedFrom]
        : undefined;
    if (renamed !== undefined || !step.direct) return renamed;
    return hasOwn(source, step.key) ? source[step.key] : undefined;
  };

  const single = (raw?: TRaw | null): T => {
    const out: Bag = { ...defaultsBag };

    if (raw) {
      const source = raw as Bag;
      const keys = Object.keys(source);

      for (let i = 0; i < keys.length; i++) {
        const key = keys[i] as string;
        if (renamedSources?.has(key)) continue;
        if (stripUnknown && !hasOwn(defaultsBag, key)) continue;
        const value = source[key];
        if (value !== undefined) out[key] = value;
      }

      for (const [from, to] of renameEntries) {
        const value = hasOwn(source, from) ? source[from] : undefined;
        if (value !== undefined) out[to] = value;
      }

      // Only values that came from the raw input are transformed; defaults are already `T`.
      for (const step of transformPlan) {
        const value = rawValueFor(source, step);
        if (value !== undefined && value !== null) out[step.key] = step.transform(value);
      }
    }

    // Copy default containers the input did not replace, so instances never share them.
    for (const key of containerKeys) {
      if (out[key] === defaultsBag[key]) out[key] = freshContainer(defaultsBag[key]);
    }

    if (computeEntries.length) {
      const source = (raw ?? {}) as Bag;
      for (const [key, derive] of computeEntries) out[key] = derive(source);
    }

    return out as T;
  };

  const list = (raws?: readonly (TRaw | null | undefined)[] | null): T[] => {
    if (!raws) return [];
    const result = new Array<T>(raws.length);
    for (let i = 0; i < raws.length; i++) result[i] = single(raws[i]);
    return result;
  };

  return { single, list, defaults: frozenDefaults };
};
