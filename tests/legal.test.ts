import "./helpers/test-env";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import {
  CONTACT_EMAIL_PLACEHOLDER,
  HEALTH_DISCLAIMER,
  PRIVACY_POLICY,
  contactEmail,
  legalPageFor,
  renderHtml,
  renderMarkdown,
} from "../server/legal";
import { server } from "../server/index";

test("contact email defaults to the placeholder and uses PRIVACY_CONTACT_EMAIL when set", () => {
  assert.equal(contactEmail({}), CONTACT_EMAIL_PLACEHOLDER);
  assert.equal(contactEmail({ PRIVACY_CONTACT_EMAIL: "  " }), CONTACT_EMAIL_PLACEHOLDER);
  assert.equal(contactEmail({ PRIVACY_CONTACT_EMAIL: "me@example.com" }), "me@example.com");
});

test("legal routes map to the right page, trailing slash allowed", () => {
  for (const p of ["/privacy", "/privacy-policy", "/privacy/"]) {
    assert.match(legalPageFor(p, "x@y.z") ?? "", /Privacy Policy/);
  }
  for (const p of ["/disclaimer", "/terms"]) {
    assert.match(legalPageFor(p, "x@y.z") ?? "", /Health Disclaimer/);
  }
  assert.equal(legalPageFor("/api/health"), null);
  assert.equal(legalPageFor("/"), null);
});

test("privacy policy covers the key disclosures", () => {
  const html = renderHtml(PRIVACY_POLICY, "privacy", CONTACT_EMAIL_PLACEHOLDER);
  for (const needle of [
    "https://ai.google.dev/gemini-api/terms",
    "https://policies.google.com/privacy",
    "https://world.openfoodfacts.org/privacy",
    "Singapore",
    "Human reviewers may read",
    "under 13",
    "Privacy Act 1988",
    "28 October 2026", "Share my progress", "nothing is sent to PortionSnap",
    "Send crash reports",
    "AI coach (PortionSnap Pro)", "recipe scan (PortionSnap Pro)", "Health Connect (PortionSnap Pro)",
    "never sent to my server, Google Gemini, the AI coach or anyone else",
    "including the Limited Use requirements", "active calories burned", "Add exercise calories to my daily target",
    "short summary of <strong>today only</strong>",
    '<span class="placeholder">CONTACT_EMAIL_HERE</span>',
  ]) {
    assert.ok(html.includes(needle), `missing: ${needle}`);
  }
  assert.ok(html.includes('<meta name="viewport"'));
});

test("email is a mailto link once configured, and markdown renders", () => {
  const html = renderHtml(HEALTH_DISCLAIMER, "disclaimer", "help@portionsnap.app");
  assert.ok(html.includes('<a href="mailto:help@portionsnap.app">help@portionsnap.app</a>'));
  const md = renderMarkdown(PRIVACY_POLICY, CONTACT_EMAIL_PLACEHOLDER);
  assert.match(md, /^# PortionSnap Privacy Policy/);
  assert.ok(md.includes("CONTACT_EMAIL_HERE"));
  assert.ok(!md.includes("{{EMAIL}}"));
});

test("HTTP: legal pages are public HTML, unknown paths still JSON 404", async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;
  try {
    for (const p of ["/privacy", "/privacy-policy", "/disclaimer", "/terms"]) {
      const res = await fetch(base + p);
      assert.equal(res.status, 200, p);
      assert.match(res.headers.get("content-type") ?? "", /^text\/html/);
      assert.match(await res.text(), /<!doctype html>/);
    }
    const head = await fetch(base + "/privacy", { method: "HEAD" });
    assert.equal(head.status, 200);
    const nf = await fetch(base + "/nope");
    assert.equal(nf.status, 404);
    assert.match(nf.headers.get("content-type") ?? "", /application\/json/);
    const post = await fetch(base + "/privacy", { method: "POST" });
    assert.equal(post.status, 404);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("legal pages name Snappy Gecko Studios and show the copyright footer", () => {
  for (const p of ["/privacy", "/disclaimer", "/terms"]) {
    const html = legalPageFor(p, "x@y.z") ?? "";
    assert.match(html, /<footer>[^<]*<br>© 2026 Snappy Gecko Studios<\/footer>/);
  }
  const privacy = legalPageFor("/privacy", "x@y.z") ?? "";
  assert.match(privacy, /made by Snappy Gecko Studios, the trading name of an individual developer based in Australia/);
  assert.match(privacy, /developed and run by Snappy Gecko Studios/);
  assert.match(renderMarkdown(PRIVACY_POLICY, "x@y.z"), /© 2026 Snappy Gecko Studios\n$/);
  assert.match(renderMarkdown(HEALTH_DISCLAIMER, "x@y.z"), /© 2026 Snappy Gecko Studios\n$/);
});
