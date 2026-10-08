import "./setup.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { isChinese } from "@rfidhot/backend/content/language";

test("declared language variants override individual Han names", () => {
  for (const language of ["ja", "ja-JP", "ko", "en", "en-US"]) assert.equal(isChinese(language, "新製品と中国移动 RFID"), false);
  for (const language of ["zh", "zh-CN", "zh-TW", "zh_Hant", " ZH-hans "]) assert.equal(isChinese(language, "RFID"), true);
});

test("unknown bodies need predominantly Chinese text without Japanese or Korean script", () => {
  assert.equal(isChinese(null, "Impinj announced a partnership with 中国移动 today."), false);
  assert.equal(isChinese("und", "新製品を発売しました。"), false);
  assert.equal(isChinese(null, "中國 기업 발표"), false);
  assert.equal(isChinese(null, "射频识别技术的发展正在推动全球物联网产业升级。RAIN RFID"), true);
  assert.equal(isChinese("und", "https://example.com/中文 12345"), false);
  assert.equal(isChinese(null, ""), false);
});
