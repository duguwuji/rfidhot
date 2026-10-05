// Licensed Chinese reading keeps source credit, excludes unlicensed media and respects exit switches.
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { sql, closeDb } from "@rfidhot/backend/db";
import { upsertMaterial } from "@rfidhot/backend/content/materials";
import { publishArticle } from "@rfidhot/backend/publication/publish";
import { stopBoss } from "@rfidhot/backend/jobs/queue";
import { buildApp } from "../apps/api/src/app.ts";

const T = tag();
const SOURCE = "web-ec-dpp";
const app = await buildApp();
before(async () => {
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, site_fulltext, syndicate_fulltext, next_fetch_at)
            VALUES (${SOURCE}, 'European Commission', 'web_list', 'T1', 'editorial', true, false, '2100-01-01')`;
});
after(async () => {
  await sql`DELETE FROM articles WHERE source_id = ${SOURCE}`;
  await sql`DELETE FROM sources WHERE id = ${SOURCE}`;
  await app.close();
  await stopBoss();
  await closeDb();
});

async function article(url: string): Promise<string> {
  const { articleId: id } = await upsertMaterial({
    sourceId: SOURCE, url, title: `Commission news ${T}`, language: "en", via: "fetch",
    bodyStatus: "ok", bodyText: `Original licensed body ${T}`, publishedAt: new Date(),
    bodyHtml: `<h2>Original heading</h2><p>Original licensed body ${T}</p><figure><img src="https://example.com/third-party.png"><figcaption>Photo credit</figcaption></figure>`,
  });
  await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, category, title_zh, summary_zh, reason_zh, score, selected)
            VALUES (${id}, 1, 'rule', 'pass', 'technology', ${`欧盟新闻-${T}`}, '摘要', '理由', 90, true)`;
  await sql`INSERT INTO translations (article_id, revision, body_html, body_text, complete, origin)
            VALUES (${id}, 1, ${`<h2>中文标题</h2><p>中文完整正文 ${T}</p><img src="https://example.com/third-party.png">`}, ${`中文完整正文 ${T}`}, true, 'model')`;
  await publishArticle(id, { releasedAt: new Date(Date.now() - 60_000) });
  return id;
}

test("licensed Chinese reading and exports credit the source and omit third-party media", async () => {
  const id = await article(`https://single-market-economy.ec.europa.eu/news/test-${T}_en`);
  const read = async (suffix = "") => JSON.parse((await app.inject(`/api/site/items/${id}${suffix}`)).body);
  const zh = await read();
  assert.equal(zh.bodyLanguage, "zh");
  assert.equal(zh.body.complete, true);
  assert.ok(zh.body.zh.includes(`中文完整正文 ${T}`));
  assert.ok(zh.body.zh.includes('CC BY 4.0') && zh.body.zh.includes('© European Union') && zh.body.zh.includes('非欧盟官方译文'));
  assert.ok(!zh.body.zh.includes("third-party.png"));
  const original = await read("/original");
  assert.equal(original.bodyLanguage, "original");
  assert.ok(original.body.original.includes(`Original licensed body ${T}`));
  assert.ok(original.body.original.includes("CC BY 4.0") && !original.body.original.includes("third-party.png"));
  const md = (await app.inject(`/items/${id}/markdown`)).body;
  assert.ok(md.includes(`中文完整正文 ${T}`) && md.includes("CC BY 4.0"));
  assert.ok(!md.includes("third-party.png"));
  assert.ok(!(await app.inject("/feed/full.xml")).body.includes(`中文完整正文 ${T}`), "website permission does not enable syndication");
  await sql`UPDATE sources SET syndicate_fulltext = true WHERE id = ${SOURCE}`;
  await publishArticle(id, { releasedAt: new Date(Date.now() - 60_000) });
  const feed = (await app.inject("/feed/full.xml")).body;
  assert.ok(feed.includes(`中文完整正文 ${T}`) && feed.includes("CC BY 4.0"), "a separately permitted full feed keeps the licence");
  assert.ok(!feed.includes("third-party.png"));
  await sql`UPDATE sources SET syndicate_fulltext = false WHERE id = ${SOURCE}`;
  await publishArticle(id, { releasedAt: new Date(Date.now() - 60_000) });
});

test("a licensed source cannot expose full text outside its verified URL scope", async () => {
  const id = await article(`https://example.com/unlicensed-${T}`);
  const detail = JSON.parse((await app.inject(`/api/site/items/${id}`)).body);
  assert.equal(detail.body, null);
  const md = (await app.inject(`/items/${id}/markdown`)).body;
  assert.ok(!md.includes(`中文完整正文 ${T}`) && !md.includes(`Original licensed body ${T}`));
});
