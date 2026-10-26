import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { createDtoFactory, RequestError, wrapRequest } from "../src";

interface Todo {
  id: number;
  title: string;
  done: boolean;
}

const todoDto = createDtoFactory<Todo>({ id: 0, title: "", done: false });

describe("wrapRequest", () => {
  describe("unwrapping", () => {
    it("returns response.data for axios-style responses", async () => {
      const get = wrapRequest(async () => ({ data: { id: 1, title: "a", done: true }, status: 200 }));
      await expect(get()).resolves.toEqual({ id: 1, title: "a", done: true });
    });

    it("passes through responses without a data field", async () => {
      const get = wrapRequest(async () => [1, 2, 3]);
      await expect(get()).resolves.toEqual([1, 2, 3]);
    });

    it("keeps the full payload when unwrapData is false", async () => {
      const get = wrapRequest(async () => ({ data: [1], truncated: true }), { unwrapData: false });
      await expect(get()).resolves.toEqual({ data: [1], truncated: true });
    });
  });

  describe("transform", () => {
    it("runs the unwrapped payload through the transform", async () => {
      const get = wrapRequest(async (id: number) => ({ data: { id } }), { transform: todoDto.single });
      await expect(get(5)).resolves.toEqual({ id: 5, title: "", done: false });
    });

    it("forwards every argument to the request", async () => {
      const request = vi.fn(async (_id: number, _query: { page: number }) => ({ data: null }));
      await wrapRequest(request)(1, { page: 2 });
      expect(request).toHaveBeenCalledWith(1, { page: 2 });
    });
  });

  describe("errors", () => {
    it("rejects with a RequestError carrying the server message, status and cause", async () => {
      const original = {
        message: "Request failed",
        response: { status: 404, data: { message: "Not found" } },
      };
      const get = wrapRequest(async () => Promise.reject(original));
      const error = await get().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(RequestError);
      expect(error).toMatchObject({ message: "Not found", status: 404, cause: original });
    });

    it("treats a throwing transform like a failed request", async () => {
      const get = wrapRequest(async () => 1, {
        transform: () => {
          throw new Error("bad shape");
        },
      });
      await expect(get()).rejects.toThrow(new RequestError("bad shape"));
    });

    it("accepts a custom mapError", async () => {
      const get = wrapRequest(async () => Promise.reject(new Error("boom")), { mapError: (e) => e });
      await expect(get()).rejects.toThrow("boom");
    });
  });

  describe("types", () => {
    it("infers the unwrapped data type", () => {
      const get = wrapRequest(async (_id: string) => ({ data: { id: 1 }, status: 200 }));
      expectTypeOf(get).parameters.toEqualTypeOf<[string]>();
      expectTypeOf(get).returns.resolves.toEqualTypeOf<{ id: number }>();
    });

    it("infers the transform's return type", () => {
      const get = wrapRequest(async () => ({ data: [] as Partial<Todo>[] }), { transform: todoDto.list });
      expectTypeOf(get).returns.resolves.toEqualTypeOf<Todo[]>();
    });

    it("keeps the full response type when unwrapData is false", () => {
      const get = wrapRequest(async () => ({ data: [1], truncated: true }), { unwrapData: false });
      expectTypeOf(get).returns.resolves.toEqualTypeOf<{ data: number[]; truncated: boolean }>();
    });

    it("rejects a transform whose input does not match the payload", () => {
      wrapRequest(async () => ({ data: 1 }), {
        // @ts-expect-error — payload is a number, not a string
        transform: (value: string) => value,
      });
    });
  });
});
