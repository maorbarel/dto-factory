import { describe, expect, expectTypeOf, it } from "vitest";
import { extractStatus, normalizeError, RequestError, type DeepPrettify } from "../src";

describe("normalizeError", () => {
  it.each([
    [
      "axios response message",
      { message: "Request failed", response: { data: { message: "Server says no" } } },
      "Server says no",
    ],
    ["axios response error field", { response: { data: { error: "Forbidden" } } }, "Forbidden"],
    ["fetch-style data.message", { data: { message: "Bad input" } }, "Bad input"],
    ["fetch-style data.error", { data: { error: "Conflict" } }, "Conflict"],
    ["Error instance", new Error("boom"), "boom"],
    ["plain string", "just a string", "just a string"],
  ])("reads %s", (_label, input, expected) => {
    expect(normalizeError(input)).toBe(expected);
  });

  it.each([null, undefined, 42, "", "   ", {}, { message: "" }, { response: null }])(
    "falls back for %j",
    (input) => {
      expect(normalizeError(input)).toBe("Unknown error");
      expect(normalizeError(input, "Try again")).toBe("Try again");
    },
  );
});

describe("extractStatus", () => {
  it("reads axios, fetch and node-style statuses", () => {
    expect(extractStatus({ response: { status: 500 } })).toBe(500);
    expect(extractStatus({ status: 401 })).toBe(401);
    expect(extractStatus({ statusCode: 429 })).toBe(429);
    expect(extractStatus(new Error("x"))).toBeUndefined();
  });
});

describe("RequestError.from", () => {
  it("returns an existing RequestError unchanged", () => {
    const error = new RequestError("x");
    expect(RequestError.from(error)).toBe(error);
  });

  it("is a real Error", () => {
    const error = RequestError.from("x");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("RequestError");
  });
});

describe("DeepPrettify", () => {
  it("is structurally identical to its input and leaves built-ins alone", () => {
    type Input = { a: { b: Date; c: Map<string, number>[] }; fn: (x: number) => string };
    expectTypeOf<DeepPrettify<Input>>().toEqualTypeOf<Input>();
    expectTypeOf<DeepPrettify<readonly string[]>>().toEqualTypeOf<readonly string[]>();
  });
});
