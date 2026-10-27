import { test } from "node:test";
import assert from "node:assert/strict";
import type http from "node:http";
import { clientIp, createScanLimiter, retryAfterSeconds } from "../server/scan-limits";

const T0 = Date.UTC(2026, 9, 27, 10, 0, 0);

test("per-IP hourly limit", () => {
  const l = createScanLimiter({ perIpHour: 3, perIpDay: 100, dailyCap: 100 });
  for (let i = 0; i < 3; i++) assert.equal(l.consume("a", T0 + i), null);
  assert.equal(l.consume("a", T0 + 10), "ip_hour");
  assert.equal(l.consume("b", T0 + 10), null, "other IPs unaffected");
  assert.equal(l.consume("a", T0 + 60 * 60 * 1000), null, "window resets after an hour");
});

test("per-IP daily limit resets at UTC midnight", () => {
  const l = createScanLimiter({ perIpHour: 100, perIpDay: 2, dailyCap: 100 });
  assert.equal(l.consume("a", T0), null);
  assert.equal(l.consume("a", T0 + 1), null);
  assert.equal(l.consume("a", T0 + 2), "ip_day");
  const nextDay = Date.UTC(2026, 9, 28, 0, 0, 1);
  assert.equal(l.consume("a", nextDay), null);
});

test("global daily cap across many IPs, incl. retries", () => {
  const l = createScanLimiter({ perIpHour: 100, perIpDay: 100, dailyCap: 3 });
  assert.equal(l.consume("1", T0), null);
  assert.equal(l.consumeGlobalOnly(T0), true);
  assert.equal(l.consume("2", T0), null);
  assert.equal(l.consumeGlobalOnly(T0), false);
  assert.equal(l.consume("3", T0), "global_day");
  assert.equal(l.check("4", T0), "global_day");
  assert.equal(l.consume("4", Date.UTC(2026, 9, 28)), null, "resets at 00:00 UTC");
});

test("blocked requests are not counted", () => {
  const l = createScanLimiter({ perIpHour: 1, perIpDay: 100, dailyCap: 2 });
  assert.equal(l.consume("a", T0), null);
  for (let i = 0; i < 5; i++) assert.equal(l.consume("a", T0), "ip_hour");
  assert.equal(l.consume("b", T0), null);
});

test("retryAfterSeconds", () => {
  assert.equal(retryAfterSeconds("ip_hour", T0), 3600);
  assert.equal(retryAfterSeconds("global_day", Date.UTC(2026, 9, 27, 23, 0, 0)), 3600);
});

const req = (headers: Record<string, string>) =>
  ({ headers, socket: { remoteAddress: "10.0.0.1" } }) as unknown as http.IncomingMessage;

test("clientIp ignores spoofed leftmost X-Forwarded-For", () => {
  assert.equal(clientIp(req({ "cf-connecting-ip": "1.1.1.1", "x-forwarded-for": "9.9.9.9, 1.1.1.1" })), "1.1.1.1");
  assert.equal(clientIp(req({ "x-forwarded-for": "9.9.9.9, 2.2.2.2" }), 1), "2.2.2.2");
  assert.equal(clientIp(req({ "x-forwarded-for": "9.9.9.9, 2.2.2.2, 3.3.3.3" }), 2), "2.2.2.2");
  assert.equal(clientIp(req({})), "10.0.0.1");
});
