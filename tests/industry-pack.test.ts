// Regression coverage for the RFID source markup: card titles must win over CTA labels,
// and rendered dates must win over unsupported epoch attributes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { allowed, fromHtml } from "@rfidhot/backend/sources/web-list";
import { noiseFiltered } from "@rfidhot/backend/sources/collect";
import { assertSupportedConfig } from "@rfidhot/backend/sources/config-keys";
import type { SourceRow } from "@rfidhot/backend/sources/types";
import { ENTITIES, CATEGORY_TAGS, TOPIC_TAGS, ENTITY_TAGS } from "@rfidhot/industry/taxonomy";

const sources = JSON.parse(readFileSync(new URL("../industry/sources.json", import.meta.url), "utf8")).sources as SourceRow[];
const source = (id: string) => sources.find((s) => s.id === id)!;

test("RFID directory resolves its entities, tags and supported source configs", () => {
  const topics = JSON.parse(readFileSync(new URL("../industry/topics.json", import.meta.url), "utf8")).topics;
  const tags = new Set<string>([...CATEGORY_TAGS, ...TOPIC_TAGS, ...ENTITY_TAGS]);
  for (const topic of topics) {
    if (topic.entityId) assert.ok(ENTITIES[topic.entityId], topic.slug);
    for (const tag of topic.tags) {
      if (tag.startsWith("entity:")) assert.ok(ENTITIES[tag.slice(7)], topic.slug);
      else assert.ok(tags.has(tag), `${topic.slug}: ${tag}`);
    }
  }
  for (const s of sources) {
    assertSupportedConfig(s.kind, s.config);
    assert.equal(s.interval_minutes, 720, `${s.id}: twelve-hour collection interval`);
  }
});

test("Avery cards retain the headline and date rather than Read more", () => {
  const s = source("web-avery-rfid");
  const rows = fromHtml('<div class="text parbase"><h5>New RAIN RFID inlay</h5><p>Company — September 15, 2026</p><div class="cta"><a href="/content/rfid/na/en/home/news-insights/press-releases/new-inlay.html">Read more</a></div></div>', s.config.url, s);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.title, "New RAIN RFID inlay");
  assert.equal(rows[0]!.publishedAt?.toISOString(), "2026-09-15T00:00:00.000Z");
});

test("Tageos cards parse rendered date instead of Unix epoch datetime", () => {
  const s = source("web-tageos-news");
  const rows = fromHtml('<div class="textteaser-icon-textwrapper"><h3>New food packaging inlay</h3><time datetime="1789477247">September 15, 2026</time><div class="textteaser-icon-text"><a href="/en/why-tageos/news/news-details/new-inlay.html">Read more</a></div></div>', s.config.url, s);
  assert.equal(rows[0]!.title, "New food packaging inlay");
  assert.equal(rows[0]!.publishedAt?.toISOString(), "2026-09-15T00:00:00.000Z");
});

test("Zebra lists accept h5 card titles and ignore navigation links", () => {
  const s = source("web-zebra-press");
  const rows = fromHtml('<a href="/us/en/about-zebra/newsroom/press-releases/2026/nav.html">Navigation</a><a href="/us/en/about-zebra/newsroom/press-releases/2026/reader.html"><h5 class="result-card-title">New RFID reader</h5></a>', s.config.url, s);
  assert.deepEqual(rows.map((r) => r.title), ["New RFID reader"]);
});

test("Hana accepts technical blogs while excluding redated news and event entries", () => {
  const s = source("rss-hana-blog");
  const blog = { title: "RFID inlay test methods", url: "https://hanarfid.com/insights/blog/test-methods/", categories: ["Blog"] };
  const news = { ...blog, url: "https://hanarfid.com/insights/news/appointment/", categories: ["News"] };
  assert.equal(allowed(blog.url, s) && !noiseFiltered(blog, s), true);
  assert.equal(allowed(news.url, s), false);
  assert.equal(noiseFiltered(news, s), true);
  assert.equal(noiseFiltered({ ...blog, categories: ["Events"] }, s), true);
});

test("Arizon dates stay with their news cards and events are excluded", () => {
  const s = source("web-arizon");
  const card = (path: string, date: string, title: string) => `<article class="card"><div class="o_wblog_post_heading"><a class="o_blog_post_title" href="${path}">${title}</a></div><div><time>${date}</time></div></article>`;
  const rows = fromHtml(card("/blog/news-5/new-inlay-42", "2026/02/25", "New ARC-certified RFID inlay") + card("/blog/events-10/expo-43", "2026/03/01", "Exhibition appearance"), s.config.url, s);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.title, "New ARC-certified RFID inlay");
  assert.equal(rows[0]!.publishedAt?.toISOString(), "2026-02-24T16:00:00.000Z");
});

test("MMH uses exact article dates regardless of attribute order and ignores navigation", () => {
  const s = source("web-mmh-news");
  const card = (slug: string, attributes: string) => `<div id="home-content"><a href="/article/${slug}/"><div class="head">RFID deployment ${slug}</div></a><div class="dateline"><span ${attributes}>October 2, 2026</span></div></div>`;
  const rows = fromHtml(card("first", 'content="2026-10-02T10:01:00-04:00" itemprop="datePublished"') + card("second", 'itemprop="datePublished" content="2026-10-02T10:02:00-04:00"') + '<a href="/article/navigation/">Read more</a>', s.config.url, s);
  assert.deepEqual(rows.map((r) => [r.title, r.publishedAt?.toISOString()]), [
    ["RFID deployment first", "2026-10-02T14:01:00.000Z"],
    ["RFID deployment second", "2026-10-02T14:02:00.000Z"],
  ]);
});
