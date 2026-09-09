import assert from "node:assert/strict";
import test from "node:test";
import { normalizeClientIp, trustedClientIpFromHeaders } from "./ai-client-ip.ts";

test("normalizes trusted IPv4 and canonical IPv6 addresses", () => {
  assert.deepEqual(normalizeClientIp("203.0.113.7"), { address: "203.0.113.7", family: 4 });
  assert.deepEqual(normalizeClientIp("2001:0DB8:0:0:0:0:0:1"), { address: "2001:db8::1", family: 6 });
  assert.deepEqual(normalizeClientIp("2001:db8::1"), { address: "2001:db8::1", family: 6 });
});

test("normalizes IPv4-mapped IPv6 as the same IPv4 /32 identity", () => {
  assert.deepEqual(normalizeClientIp("::ffff:192.0.2.128"), { address: "192.0.2.128", family: 4 });
  assert.deepEqual(normalizeClientIp("0:0:0:0:0:ffff:c000:0280"), { address: "192.0.2.128", family: 4 });
});

test("accepts only the single trusted Vercel header value", () => {
  assert.deepEqual(
    trustedClientIpFromHeaders(new Headers({ "x-vercel-forwarded-for": "198.51.100.9" })),
    { address: "198.51.100.9", family: 4 },
  );
  assert.equal(trustedClientIpFromHeaders(new Headers({ "x-forwarded-for": "198.51.100.9" })), null);
  assert.equal(
    trustedClientIpFromHeaders(new Headers({ "x-vercel-forwarded-for": "198.51.100.9, 10.0.0.1" })),
    null,
  );
  assert.equal(trustedClientIpFromHeaders(new Headers()), null);
});

test("rejects ports, zones and malformed addresses", () => {
  for (const value of ["203.0.113.7:443", "[2001:db8::1]", "fe80::1%eth0", "999.0.0.1", "not-an-ip", ""]) {
    assert.equal(normalizeClientIp(value), null);
  }
});
