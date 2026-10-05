# 精选新闻的中文全文

精选的正文由 worker 分段翻译，默认阅读页展示中文，并提供原文切换。页面读取不会触发模型请求。译文保留段落、标题和链接；缺少段落时显示“译文尚不完整”，不会标成中文全文。既有精选新闻在信源获得全文许可后也进入翻译队列，不再仅限最近三天入库的新闻；单次仍受条数、时间、请求回执及模型预算限制。

## 已核验许可

2026-10-06 核验欧盟委员会 [法律声明](https://commission.europa.eu/legal-notice_en)：除另有说明外，欧盟拥有的内容可按 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 再使用，须署名并说明修改。第三方作品、标识等不在此许可内。

`industry/fulltext.ts` 记录 `web-ec-dpp` 的新闻 URL 范围、署名和许可。公开读取层为中文译文、原文及 Markdown 添加来源和许可说明，注明 AI 辅助翻译不是官方译文，并移除图片和第三方媒体。示范信源启用 `site_fulltext`，保留 `syndicate_fulltext=false`。现有站点的信源不会被 seed 覆盖，需通过管理员信源更新开启，worker 随后重建公开投影。

核验的既有精选：

- [数字电池护照准备指南，2026-08-21](https://single-market-economy.ec.europa.eu/news/guidance-support-preparations-digital-batteries-passport-2026-08-21_en)
- [数字产品护照注册系统上线，2026-07-20](https://single-market-economy.ec.europa.eu/news/digital-product-passport-registry-now-live-2026-07-20_en)

Impinj、Avery Dennison、行业媒体等来源尚无经核验的全文许可，继续使用摘要和原文入口。新增许可需记录证据并核对转载范围；公开网站的访问权限、新闻稿或软件开源许可本身不代表允许转载新闻全文。
