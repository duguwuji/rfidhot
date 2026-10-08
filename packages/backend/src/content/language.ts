/** Declared language wins; unknown text must be predominantly Chinese, not just contain a name. */
export function isChinese(language: string | null, sample: string): boolean {
  const base = language?.trim().toLowerCase().replace(/_/g, "-").split("-")[0];
  if (base && !["und", "unknown", "auto"].includes(base)) return base === "zh";
  const text = sample.slice(0, 2000).replace(/https?:\/\/\S+/g, "");
  if (/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text)) return false;
  const letters = text.match(/\p{L}/gu) ?? [];
  const han = text.match(/\p{Script=Han}/gu) ?? [];
  return letters.length > 0 && han.length / letters.length >= 0.6;
}
