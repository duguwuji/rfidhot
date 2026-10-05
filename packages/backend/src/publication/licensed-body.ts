// Source credit and permitted media belong to the public reading projection, never the stored text.
import * as cheerio from "cheerio";
import { FULLTEXT_LICENSES } from "@rfidhot/industry/fulltext";
import { escapeXml } from "../lib/text.ts";

export function licensedBody(html: string, sourceId: string, originalUrl: string, translated: boolean): string | null {
  const license = FULLTEXT_LICENSES[sourceId];
  if (!license) return html;
  if (!originalUrl.startsWith(license.urlPrefix)) return null;
  if (license.textOnly) {
    const $ = cheerio.load(html, null, false);
    $("figure, picture, img, video, audio, iframe").remove();
    html = $.html();
  }
  const notice = translated ? "本文为 AI 辅助中文翻译，非欧盟官方译文。" : "正文保留原文。";
  return `${html}<p>${escapeXml(license.attribution)} · <a href="${escapeXml(originalUrl)}">原文</a> · <a href="${escapeXml(license.url)}">${escapeXml(license.name)}</a>。${notice}${license.textOnly ? "图片及第三方媒体未转载。" : ""}</p>`;
}
