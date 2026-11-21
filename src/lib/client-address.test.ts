import { describe, expect, it } from "vitest";
import { clientAddress } from "./client-address";

const hdrs = (o: Record<string, string>) => new Headers(o);

describe("clientAddress (S6)", () => {
  it("behind our proxy: the last hop, the one the proxy added", () => {
    expect(clientAddress(hdrs({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }), true)).toBe("203.0.113.9");
    expect(clientAddress(hdrs({ "x-real-ip": "198.51.100.1" }), true)).toBe("198.51.100.1");
    expect(clientAddress(hdrs({}), true)).toBeNull();
  });
  it("without a proxy: a client-made list is ignored; the socket address Next.js sets is used", () => {
    expect(clientAddress(hdrs({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }), false)).toBeNull();
    expect(clientAddress(hdrs({ "x-forwarded-for": "not an address" }), false)).toBeNull();
    expect(clientAddress(hdrs({ "x-forwarded-for": "::1" }), false)).toBe("::1");
    expect(clientAddress(hdrs({ "x-real-ip": "198.51.100.1" }), false)).toBeNull();
  });
});
