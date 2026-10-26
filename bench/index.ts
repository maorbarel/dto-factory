import { Bench } from "tinybench";
import { z } from "zod";
import { createDtoFactory } from "../src";

interface Order {
  id: string;
  customer: string;
  total: number;
  status: string;
  items: string[];
  createdAt: Date | null;
  notes: string;
}

interface RawOrder {
  id?: string;
  customer_name?: string;
  total?: number;
  status?: string;
  items?: string[];
  createdAt?: string | null;
  notes?: string;
}

const RECORDS = 10_000;

const defaults: Order = {
  id: "",
  customer: "",
  total: 0,
  status: "new",
  items: [],
  createdAt: null,
  notes: "",
};

const raws: RawOrder[] = Array.from({ length: RECORDS }, (_, i) => ({
  id: String(i),
  customer_name: `Customer ${i}`,
  total: i * 1.5,
  status: i % 2 ? "paid" : undefined,
  items: ["a", "b"],
  createdAt: i % 3 ? "2024-01-01T00:00:00.000Z" : null,
}));

const factory = createDtoFactory<Order, RawOrder>(defaults, {
  renameKeys: { customer_name: "customer" },
  transforms: { createdAt: (value) => new Date(value) },
});

// Hand-written equivalent: what most codebases do inline.
const handWritten = (raw: RawOrder): Order => ({
  id: raw.id ?? defaults.id,
  customer: raw.customer_name ?? defaults.customer,
  total: raw.total ?? defaults.total,
  status: raw.status ?? defaults.status,
  items: raw.items ?? [],
  createdAt: raw.createdAt ? new Date(raw.createdAt) : null,
  notes: raw.notes ?? defaults.notes,
});

// Naive spread — fast, but `undefined` overrides defaults and nothing is renamed or parsed.
const naiveSpread = (raw: RawOrder) => ({ ...defaults, ...raw });

const zodSchema = z
  .object({
    id: z.string().default(""),
    customer_name: z.string().default(""),
    total: z.number().default(0),
    status: z.string().default("new"),
    items: z.array(z.string()).default([]),
    createdAt: z.string().nullable().default(null),
    notes: z.string().default(""),
  })
  .transform(({ customer_name, createdAt, ...rest }): Order => ({
    ...rest,
    customer: customer_name,
    createdAt: createdAt ? new Date(createdAt) : null,
  }));

const bench = new Bench({
  name: `shape ${RECORDS.toLocaleString("en-US")} records (rename + date parse)`,
  time: 3000,
  warmupTime: 500,
})
  .add("createDtoFactory.list", () => {
    factory.list(raws);
  })
  .add("hand-written mapper", () => {
    raws.map(handWritten);
  })
  .add("naive spread (incorrect output)", () => {
    raws.map(naiveSpread);
  })
  .add("zod parse + transform", () => {
    raws.map((raw) => zodSchema.parse(raw));
  });

await bench.run();

console.log(`${bench.name} — node ${process.version}`);
console.table(bench.table());
