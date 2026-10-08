// Shared with receipt recovery: every judging stage can stop an article on an unknown answer.
export const ANALYSIS_PURPOSES = {
  prefilter: "prefilter_article",
  score: "score_article",
  structure: "structure_article",
  understand: "understand_article",
  summarize: "summarize_article",
} as const;

export function isAnalysisPurpose(purpose: string): boolean {
  return purpose === "analyze_article" || Object.values(ANALYSIS_PURPOSES).some((value) => value === purpose);
}
