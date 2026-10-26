import { describe, expect, expectTypeOf, it } from "vitest";
import { createDtoFactory } from "../src";

interface User {
  id: string;
  name: string;
  age: number;
  tags: string[];
  createdAt: Date | null;
}

const userDefaults: User = { id: "", name: "", age: 0, tags: [], createdAt: null };

describe("createDtoFactory", () => {
  describe("single", () => {
    it("fills every missing field from defaults", () => {
      const { single } = createDtoFactory(userDefaults);
      expect(single({ id: "1" })).toEqual({ ...userDefaults, id: "1" });
    });

    it("returns a fresh copy of the defaults for null/undefined input", () => {
      const { single } = createDtoFactory(userDefaults);
      expect(single(null)).toEqual(userDefaults);
      expect(single(undefined)).toEqual(userDefaults);
      expect(single()).not.toBe(single());
    });

    it("never lets undefined override a default, but keeps null and falsy values", () => {
      const { single } = createDtoFactory(userDefaults);
      const user = single({ name: undefined, age: 0, createdAt: null, id: "" });
      expect(user.name).toBe("");
      expect(user.createdAt).toBeNull();
      expect(user.age).toBe(0);
    });

    it("keeps unknown keys by default", () => {
      const { single } = createDtoFactory<User, Partial<User> & { extra: boolean }>(userDefaults);
      expect(single({ extra: true })).toHaveProperty("extra", true);
    });

    it("drops unknown keys with stripUnknown", () => {
      const { single } = createDtoFactory<User, Partial<User> & { extra: boolean }>(userDefaults, {
        stripUnknown: true,
      });
      expect(single({ id: "1", extra: true })).not.toHaveProperty("extra");
    });

    it("gives every instance its own default arrays and objects", () => {
      const { single, defaults } = createDtoFactory({ list: [] as number[], meta: { seen: false } });
      const a = single();
      const b = single();
      a.list.push(1);
      a.meta.seen = true;
      expect(b.list).toEqual([]);
      expect(b.meta.seen).toBe(false);
      expect(defaults.list).toEqual([]);
    });

    it("ignores inherited properties on the raw input", () => {
      const { single } = createDtoFactory(userDefaults);
      const raw = Object.create({ name: "inherited" }) as Partial<User>;
      expect(single(raw).name).toBe("");
    });
  });

  describe("renameKeys", () => {
    interface RawUser {
      user_id?: string;
      full_name?: string;
    }

    const factory = createDtoFactory<User, RawUser>(userDefaults, {
      renameKeys: { user_id: "id", full_name: "name" },
    });

    it("maps raw keys onto output keys", () => {
      expect(factory.single({ user_id: "7", full_name: "Ada" })).toMatchObject({ id: "7", name: "Ada" });
    });

    it("does not leak the raw key onto the output", () => {
      expect(factory.single({ user_id: "7" })).not.toHaveProperty("user_id");
    });

    it("keeps the default when the renamed source is undefined", () => {
      expect(factory.single({ full_name: undefined }).name).toBe("");
    });
  });

  describe("transforms", () => {
    interface RawUser {
      id?: string;
      createdAt?: string | null;
      tags?: string;
    }

    const factory = createDtoFactory<User, RawUser>(userDefaults, {
      transforms: {
        createdAt: (value) => new Date(value),
        tags: (value) => value.split(","),
      },
    });

    it("shapes values that came from the raw input", () => {
      const user = factory.single({ createdAt: "2024-01-01T00:00:00.000Z", tags: "a,b" });
      expect(user.createdAt).toEqual(new Date("2024-01-01T00:00:00.000Z"));
      expect(user.tags).toEqual(["a", "b"]);
    });

    it("skips null and missing values, leaving defaults untransformed", () => {
      const user = factory.single({ createdAt: null });
      expect(user.createdAt).toBeNull();
      expect(user.tags).toEqual([]);
    });

    it("applies to renamed fields too", () => {
      const { single } = createDtoFactory<User, { created?: string }>(userDefaults, {
        renameKeys: { created: "createdAt" },
        transforms: { createdAt: (value) => new Date(String(value)) },
      });
      expect(single({ created: "2024-01-01T00:00:00.000Z" }).createdAt).toBeInstanceOf(Date);
    });

    it("types the transform argument as the non-nullable raw value", () => {
      createDtoFactory<User, RawUser>(userDefaults, {
        transforms: {
          createdAt: (value) => {
            expectTypeOf(value).toEqualTypeOf<string>();
            return null;
          },
        },
      });
    });
  });

  describe("compute", () => {
    interface RawEvent {
      id?: string;
      eventType?: string;
      event?: string;
    }
    interface AppEvent {
      id: string;
      eventType: string;
    }

    let counter = 0;
    const factory = createDtoFactory<AppEvent, RawEvent>(
      { id: "", eventType: "" },
      {
        compute: {
          id: (raw) => raw.id || `generated-${++counter}`,
          eventType: (raw) => raw.eventType ?? raw.event ?? "unknown",
        },
      },
    );

    it("derives fields from the whole raw object", () => {
      expect(factory.single({ event: "click" })).toMatchObject({ eventType: "click" });
      expect(factory.single({ id: "x" }).id).toBe("x");
    });

    it("runs for null input and wins over merged values", () => {
      expect(factory.single(null)).toEqual({
        id: expect.stringMatching(/^generated-/),
        eventType: "unknown",
      });
    });
  });

  describe("list", () => {
    const { list } = createDtoFactory(userDefaults);

    it("shapes every item and tolerates null items", () => {
      expect(list([{ id: "1" }, null])).toEqual([
        { ...userDefaults, id: "1" },
        { ...userDefaults, tags: [] },
      ]);
    });

    it("returns [] for null/undefined", () => {
      expect(list(null)).toEqual([]);
      expect(list(undefined)).toEqual([]);
    });
  });

  describe("defaults", () => {
    it("is frozen", () => {
      const { defaults } = createDtoFactory(userDefaults);
      expect(Object.isFrozen(defaults)).toBe(true);
    });
  });

  describe("types", () => {
    it("infers the output type from the defaults", () => {
      const { single, list, defaults } = createDtoFactory(userDefaults);
      expectTypeOf(single).returns.toEqualTypeOf<User>();
      expectTypeOf(list).returns.toEqualTypeOf<User[]>();
      expectTypeOf(defaults).toEqualTypeOf<Readonly<User>>();
    });

    it("only accepts output keys as rename targets", () => {
      createDtoFactory<User, { user_id?: string }>(userDefaults, {
        // @ts-expect-error — "userId" is not a key of User
        renameKeys: { user_id: "userId" },
      });
    });

    it("requires transforms to return the output field type", () => {
      createDtoFactory<User, { age?: string }>(userDefaults, {
        // @ts-expect-error — age must be a number
        transforms: { age: (value) => value },
      });
    });

    it("requires complete defaults", () => {
      // @ts-expect-error — `tags` and `createdAt` are missing
      createDtoFactory<User>({ id: "", name: "", age: 0 });
    });
  });
});

describe("recipes", () => {
  interface Address {
    city: string;
    zip: string;
  }
  interface Customer {
    id: string;
    address: Address;
    orderIds: string[];
  }
  interface RawCustomer {
    id?: string;
    address?: Partial<Address> | null;
    orderIds?: string[];
  }

  const addressDto = createDtoFactory<Address>({ city: "", zip: "" });
  const customerDto = createDtoFactory<Customer, RawCustomer>(
    { id: "", address: addressDto.defaults, orderIds: [] },
    { transforms: { address: addressDto.single } },
  );

  it("composes factories for nested shapes", () => {
    expect(customerDto.single({ address: { city: "Haifa" } }).address).toEqual({ city: "Haifa", zip: "" });
  });

  it("gives a missing nested object its own mutable copy of the nested defaults", () => {
    const customer = customerDto.single({ id: "1" });
    customer.address.city = "Eilat";
    expect(customerDto.single().address.city).toBe("");
    expect(Object.isFrozen(customer.address)).toBe(false);
  });
});
