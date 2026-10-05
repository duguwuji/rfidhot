// Verified website reuse permissions. Source switches still control whether a body is published.
// Keep the article URL scope narrow; a software licence does not license a publisher's news.
export const FULLTEXT_LICENSES: Record<string, {
  urlPrefix: string;
  attribution: string;
  name: string;
  url: string;
  evidenceUrl: string;
  textOnly: boolean;
}> = {
  "web-ec-dpp": {
    urlPrefix: "https://single-market-economy.ec.europa.eu/news/",
    attribution: "© European Union",
    name: "CC BY 4.0",
    url: "https://creativecommons.org/licenses/by/4.0/",
    evidenceUrl: "https://commission.europa.eu/legal-notice_en",
    // The Commission's reuse notice excludes third-party works and logos.
    textOnly: true,
  },
};
