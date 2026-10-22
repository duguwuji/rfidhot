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

test("Avery datelines support older separators and date order without inventing a missing day", () => {
  const s = source("web-avery-rfid");
  const card = (n: number, dateline: string) => `<div class="text parbase"><h5>RFID announcement ${n}</h5><p>${dateline} — Company announcement.</p><div class="cta"><a href="/en/home/news-insights/press-releases/post-${n}.html">read</a></div></div>`;
  const dates = ["MENTOR, OH —&nbsp; March 2, 2020", "GLENDALE, CA – March 2, 2020", "GLENDALE, CA, March 2, 2020", "GLENDALE, CA – 2 March 2020"];
  const rows = fromHtml(dates.map((d, n) => card(n, d)).join("") + card(4, "SAO PAULO, Brazil, January 2020"), s.config.url, s);
  assert.equal(rows.length, 5);
  assert.ok(rows.slice(0, 4).every((r) => r.publishedAt?.toISOString() === "2020-03-02T00:00:00.000Z"));
  assert.equal(rows[4]!.publishedAt, null);
});

test("Impinj blog cards retain source dates beyond the detail budget and exclude the undated spotlight", () => {
  const s = source("web-impinj-blog");
  const card = (n: number) => `<a class="feature-destination" href="/library/blog/post-${n}"><h5 class="feature-heading">RFID technical post ${n}</h5><p class="feature-copy">Card summary mentioning a different date, 2026.</p><small class="feature-meta">15 Jul 2025</small></a>`;
  const spotlight = '<a class="spotlight-heading-link" href="/library/blog/post-0">Featured RFID technical post</a>';
  const rows = fromHtml(spotlight + Array.from({ length: 12 }, (_, n) => card(n)).join(""), s.config.url, s);
  assert.equal(rows.length, 12);
  assert.ok(rows.length > s.config.detail.maxFetches);
  assert.equal(rows[0]!.title, "RFID technical post 0");
  assert.ok(rows.every((r) => r.publishedAt?.toISOString() === "2025-07-15T00:00:00.000Z"));
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

test("Chainway news cards keep the headline and listed date", () => {
  const s = source("web-chainway-news");
  const rows = fromHtml('<div class="item"><a href="/News/Info/561"><div class="text_wrap"><h3>Chainway Launches C5E UHF RFID Reader</h3><span class="date">2026-09-23</span></div></a></div><div class="item"><a href="/About">About</a></div>', s.config.url, s);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.title, "Chainway Launches C5E UHF RFID Reader");
  assert.equal(rows[0]!.publishedAt?.toISOString().slice(0, 10), "2026-09-23");
});

test("Xminnov (英诺尔) news keeps the Chinese headline and time element date", () => {
  const s = source("web-xminnov-news");
  const rows = fromHtml('<a href="/Ne2_d_gci_233_id_132.html"><div class="writtenwr clearfix"><div class="writtenle"><time>2026-08-24</time></div><div class="writtenfix"><h3>告别“找货难”！英诺尔让仓储寻货迈入“秒级时代”</h3></div></div></a><a href="/Job_index_gci_199.html">招聘</a>', s.config.url, s);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.title, "告别“找货难”！英诺尔让仓储寻货迈入“秒级时代”");
  assert.equal(rows[0]!.publishedAt?.toISOString().slice(0, 10), "2026-08-24");
});

test("AIM China list takes the article title and leaves the date to the detail page", () => {
  const s = source("web-aimchina-news");
  const rows = fromHtml('<ul><li class="newsColumn"><a class="newsTitleText" href="/index/news/detail/detail_id/11622/id/9/pid/1.html">中国自动识别技术协会第五届理事会扩大会于福州举办</a><div class="newsContentText">2026年9月22日，会议在福州举办</div></li></ul>', s.config.url, s);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.title, "中国自动识别技术协会第五届理事会扩大会于福州举办");
  assert.equal(rows[0]!.publishedAt, null);
  assert.ok(new RegExp(s.config.detail.publishedAtRegex).exec("<p class=\"newsVideoContentText\">发布时间：2026-09-23</p>"));
});
