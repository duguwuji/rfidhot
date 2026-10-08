import "./setup.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { passwordAttemptLimiter } from "../apps/api/src/http/password-limiter.ts";

test("rejected client attempts do not consume another client's login allowance", () => {
  let now = 0;
  const limited = passwordAttemptLimiter(() => now);
  for (let i = 0; i < 10; i++) assert.equal(limited("attacker"), false);
  for (let i = 0; i < 100_000; i++) assert.equal(limited("attacker"), true);
  assert.equal(limited("admin"), false);
  now = 15 * 60_000;
  assert.equal(limited("attacker"), false, "old accepted attempts expire");
});

test("global accepted attempts stay bounded and rejected traffic does not extend the window", () => {
  let now = 1000;
  const limited = passwordAttemptLimiter(() => now);
  for (let i = 0; i < 50; i++) assert.equal(limited(`client-${i}`), false);
  now += 15 * 60_000 - 1;
  for (let i = 0; i < 10_000; i++) assert.equal(limited(`rejected-${i}`), true);
  now += 1;
  assert.equal(limited("admin"), false);
  for (let i = 1; i < 10; i++) assert.equal(limited("admin"), false);
  assert.equal(limited("admin"), true);
});
