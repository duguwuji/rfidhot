# 精选新闻的中文全文

精选的正文由 worker 分段翻译，默认阅读页展示中文，并提供原文切换。页面读取不会触发模型请求。译文保留段落、标题和链接；缺少段落时显示“译文尚不完整”，不会标成中文全文。既有精选新闻在信源获得全文许可后也进入翻译队列，不再仅限最近三天入库的新闻；单次仍受条数、时间、请求回执及模型预算限制。

只有精选新闻展示正文：信源的 `site_fulltext` 开关打开后，非精选新闻仍只提供标题、摘要和原文链接。默认阅读、原文切换及 Markdown 导出遵循同一限制；取消精选后，即使数据库保留正文和译文，也不再公开展示。重新入选可复用已有译文。尚无译文的精选暂时展示原文，翻译由后台继续处理。

## 已核验许可

2026-10-06 核验欧盟委员会 [法律声明](https://commission.europa.eu/legal-notice_en)：除另有说明外，欧盟拥有的内容可按 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 再使用，须署名并说明修改。第三方作品、标识等不在此许可内。

`industry/fulltext.ts` 记录 `web-ec-dpp` 的新闻 URL 范围、署名和许可。公开读取层为中文译文、原文及 Markdown 添加来源和许可说明，注明 AI 辅助翻译不是官方译文，并移除图片和第三方媒体。示范信源启用 `site_fulltext`，保留 `syndicate_fulltext=false`。现有站点的信源不会被 seed 覆盖，需通过管理员信源更新开启，worker 随后重建公开投影。

核验的既有精选：

- [数字电池护照准备指南，2026-08-21](https://single-market-economy.ec.europa.eu/news/guidance-support-preparations-digital-batteries-passport-2026-08-21_en)
- [数字产品护照注册系统上线，2026-07-20](https://single-market-economy.ec.europa.eu/news/digital-product-passport-registry-now-live-2026-07-20_en)

## 本站的全文开关设置

2026-10-06 使用者明确要求“打开所有可用信源全文开关”。本部署据此为所有当前启用、参与编辑的信源开启 `site_fulltext`；应用时为 31 个，其中 3GPP 已在现有数据库启用。行业包保留原有的采集启停设置，网站全文预设与当前部署名单对应。既有数据库通过管理员信源更新函数逐项修改并记录该操作要求，worker 随后重建公开投影、补译已有精选。

网站开关设置与版权许可记录分别保存：除上述欧盟来源外，不把这次使用者的设置要求标成已核验的来源许可，也不添加 Creative Commons 声明。正文保留来源及原文入口，中文翻译沿用 AI 翻译标记。RSS/API 全文再分发不随网站开关开放。
