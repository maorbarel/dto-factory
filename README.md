# dto-factory

[![CI](https://github.com/maorbarel/dto-factory/actions/workflows/ci.yml/badge.svg)](https://github.com/maorbarel/dto-factory/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@maorbarel/dto-factory)](https://www.npmjs.com/package/@maorbarel/dto-factory)
![types](https://img.shields.io/badge/types-included-blue)
![deps](https://img.shields.io/badge/dependencies-0-brightgreen)

**Typed factories that turn loosely-shaped API data into complete, predictable objects.**
Zero dependencies, ~1 KB min+gz, ESM + CJS.

```ts
const userDto = createDtoFactory<User, RawUser>(
  { id: "", name: "", roles: [], createdAt: null },
  {
    renameKeys: { full_name: "name" },
    transforms: { createdAt: (iso) => new Date(iso) },
  },
);

userDto.single({ id: "7", full_name: "Ada", createdAt: "2024-01-01" });
// → { id: "7", name: "Ada", roles: [], createdAt: Date(2024-01-01) }
```

---

## The problem

Front-end code trusts server data more than it should. Fields go missing, arrive as
`undefined`, change names between API versions, or come as strings that should be dates.
The usual fixes all hurt:

| Approach                       | What goes wrong                                                                                |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| `{ ...defaults, ...raw }`      | `undefined` from the server **overwrites** your default. Nothing is renamed.                   |
| Hand-written mapper per entity | Correct, but every new field must be added in three places — and someone forgets.              |
| One class per entity           | Same boilerplate, plus `new` everywhere and awkward serialization.                             |
| A validation library (zod, …)  | Built to _reject_ bad data. You wanted to _repair_ it — and pay for validation you don't need. |

`dto-factory` takes one declaration — a complete default object — and derives everything
from it. Because `defaults` must be a full `T`, **the compiler tells you when a newly added
field has no fallback**.

## Install

```sh
pnpm add @maorbarel/dto-factory
# or npm i / yarn add
```

## Quick start

```ts
import { createDtoFactory, wrapRequest } from "@maorbarel/dto-factory";

interface Order {
  id: string;
  customer: string;
  total: number;
  items: string[];
  createdAt: Date | null;
}

// What the server actually sends.
interface RawOrder {
  id?: string;
  customer_name?: string;
  total?: number;
  items?: string[];
  createdAt?: string | null;
}

export const orderDto = createDtoFactory<Order, RawOrder>(
  { id: "", customer: "", total: 0, items: [], createdAt: null },
  {
    renameKeys: { customer_name: "customer" },
    transforms: { createdAt: (iso) => new Date(iso) },
  },
);

// Plug it into your HTTP layer — axios, fetch, anything that returns a promise.
export const getOrders = wrapRequest((page: number) => http.get<RawOrder[]>(`/orders?page=${page}`), {
  transform: orderDto.list,
});

const orders = await getOrders(1); // Order[] — every field present, dates parsed
```

## API

### `createDtoFactory<T, TRaw = Partial<T>>(defaults, options?)`

Returns `{ single, list, defaults }`.

| Member         | Description                                                                    |
| -------------- | ------------------------------------------------------------------------------ |
| `single(raw?)` | Shape one entity. `null`/`undefined` returns a fresh copy of the defaults.     |
| `list(raws?)`  | Shape an array. `null`/`undefined` returns `[]`; `null` items become defaults. |
| `defaults`     | The defaults, frozen. Handy for form resets and tests.                         |

**Options**

| Option         | Type                                   | Description                                                                            |
| -------------- | -------------------------------------- | -------------------------------------------------------------------------------------- |
| `renameKeys`   | `{ [rawKey]: keyof T }`                | Map raw keys onto output keys. The raw key is not copied to the output.                |
| `transforms`   | `{ [K in keyof T]?: (value) => T[K] }` | Shape a value that came from the input. Never runs on defaults, `null` or `undefined`. |
| `compute`      | `{ [K in keyof T]?: (raw) => T[K] }`   | Derive a field from the whole raw object. Runs last, always — even for `null` input.   |
| `stripUnknown` | `boolean` (default `false`)            | Drop raw keys that have no counterpart in `defaults`.                                  |

Pipeline per entity: **defaults → raw fields → renames → transforms → compute**.

Everything is type-checked: rename targets must be keys of `T`, transforms must return
`T[K]`, and a transform's argument is the non-nullable raw type of that field.

### `wrapRequest(request, options?)`

Wraps any `(...args) => Promise<Response>` so every call unwraps, transforms, and fails the
same way. Argument types and the return type are inferred.

| Option       | Default             | Description                                                                                           |
| ------------ | ------------------- | ----------------------------------------------------------------------------------------------------- |
| `transform`  | —                   | Shape the payload — usually `dto.single` or `dto.list`.                                               |
| `unwrapData` | `true`              | Return `response.data` when present (axios-style). Turn off if the payload itself has a `data` field. |
| `mapError`   | `RequestError.from` | Map anything thrown — by the request _or_ the transform — before rejecting.                           |

### `RequestError`

`Error` subclass with `message` (normalized), `status` (HTTP status when available) and
`cause` (the original error). `RequestError.from(anything)` builds one.

### `normalizeError(error, fallback = "Unknown error")`

Pulls a human-readable message out of anything that was thrown, preferring the server's own
message over the transport's generic one:
`response.data.message` → `response.data.error` → `data.message` → `data.error` → `message` →
the string itself → `fallback`.

### `DeepPrettify<T>`

A type helper that expands aliases like `Omit<A, "x"> & B` into their full structure in
editor tooltips. `wrapRequest` applies it to its return type, so hovering a call shows the
actual shape of the data.

## Recipes

### Nested DTOs

The merge is shallow by design. Compose factories for nested shapes:

```ts
const addressDto = createDtoFactory<Address>({ city: "", zip: "" });

const customerDto = createDtoFactory<Customer, RawCustomer>(
  { id: "", address: addressDto.defaults, orders: [] },
  {
    transforms: {
      address: addressDto.single,
      orders: orderDto.list,
    },
  },
);
```

A missing `address` gets a fresh copy of the nested defaults; a partial one is completed by
`addressDto`.

### Renamed keys, including awkward ones

```ts
createDtoFactory<Zone, { "Map Zones"?: string[]; zone_id?: string }>(
  { id: "", mapZones: [] },
  { renameKeys: { "Map Zones": "mapZones", zone_id: "id" } },
);
```

Transforms apply to renamed fields too — key them by the **output** name.

### Computed ids and multi-key fallbacks

```ts
createDtoFactory<AuditEvent, RawAuditEvent>(
  { id: "", type: "" },
  {
    compute: {
      id: (raw) => raw.id ?? crypto.randomUUID(), // stable list keys even when the server sends none
      type: (raw) => raw.eventType ?? raw.event ?? "unknown", // field renamed between API versions
    },
  },
);
```

### Sharing options between related entities

Options are plain objects, so spread a base:

```ts
const baseAudit = { renameKeys: { timestamp: "created" } } as const;

const loginAuditDto = createDtoFactory<LoginAudit, RawLoginAudit>({ ...baseDefaults, ip: "" }, baseAudit);
const exportAuditDto = createDtoFactory<ExportAudit, RawExportAudit>({ ...baseDefaults, rows: 0 }, baseAudit);
```

## Why not zod?

Use zod (or valibot, arktype) at **trust boundaries** where bad data must be rejected: user
input, webhooks, config files.

`dto-factory` is for the other case — data from **your own API** that you trust to be
roughly right, and want to make **exactly** right: fill gaps, rename, parse, never throw.

|                            | `dto-factory`             | zod                                 |
| -------------------------- | ------------------------- | ----------------------------------- |
| Goal                       | Repair & shape            | Validate & reject                   |
| Bad field                  | Falls back to the default | Throws (or returns an error)        |
| Source of truth            | Your TypeScript interface | The schema (types inferred from it) |
| Runtime cost (10k records) | **2.2 ms**                | 4.2 ms                              |
| Bundle                     | ~1 KB, 0 deps             | larger                              |

They compose well: validate at the edge with zod, shape internally with `dto-factory`.

## Benchmarks

Shaping 10,000 records (one rename, one ISO-date parse, missing fields), `pnpm bench`.
Apple M2 Pro, Node 22.13, tinybench, median of 700–3,500 samples:

| Implementation                  | Per batch (10k) |  Per record | Correct output |
| ------------------------------- | --------------: | ----------: | :------------: |
| Naive `{ ...defaults, ...raw }` |         0.85 ms |     0.09 µs |       ❌       |
| Hand-written mapper             |         1.00 ms |     0.10 µs |       ✅       |
| **`createDtoFactory().list`**   |     **2.21 ms** | **0.22 µs** |       ✅       |
| zod `parse` + `transform`       |         4.23 ms |     0.42 µs |       ✅       |

About **2× a hand-written mapper** and **~2× faster than zod** — at 0.22 µs per record it
will never be the bottleneck next to the network request that produced the data.
Run it yourself with `pnpm bench`; source in [`bench/index.ts`](bench/index.ts).

## Design notes

- **`undefined` never overrides a default; `null` does.** `undefined` means "the server
  didn't say"; `null` is a value the server chose. Collapsing them is how bugs hide.
- **Shallow merge, on purpose.** Deep merging guesses what you meant for arrays and class
  instances, and costs a lot on large lists. Nested shapes are explicit: compose factories.
- **Instances never share containers.** Array and plain-object defaults are copied per
  instance, so `a.items.push(x)` can't leak into `b.items` or into `defaults`.
- **Transforms only see real input.** They never run on defaults or `null`, so a transform
  can assume its argument is the raw type and not defend against fallbacks.
- **Hot path is allocation-light.** Renames and transform sources are resolved once, when the
  factory is created; per record it's one object spread and a single pass over the input's
  keys.
- **One error type.** `wrapRequest` rejects with `RequestError` — never a bare string — so
  callers get a real stack, a `status`, and the original error as `cause`.

## Development

```sh
pnpm install
pnpm test        # vitest, including type-level tests (expectTypeOf, @ts-expect-error)
pnpm typecheck   # tsc --noEmit over src, tests and bench
pnpm lint        # eslint + prettier
pnpm build       # tsup → dist/ (ESM, CJS, .d.ts, .d.cts)
pnpm bench       # tinybench
```

Releases use [changesets](https://github.com/changesets/changesets): `pnpm changeset`, then
`pnpm release`.

## License

[MIT](LICENSE) © Maor Barel
