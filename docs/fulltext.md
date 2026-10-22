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

2026-10-06 曾按使用者要求为所有当前启用、参与编辑的信源开启 `site_fulltext`（应用时 31 个）。这些来源除欧盟外都没有核验过的再使用许可，厂商通稿和行业媒体（如 RFID Journal、MMH、RFID 世界网）的全文与 AI 译文公开展示存在版权风险。

2026-10-18 经运营者确认收回：

- 行业包 `industry/sources.json` 中只有 `web-ec-dpp` 保留 `site_fulltext=true`，其余来源改为 `false`；`syndicate_fulltext` 全部保持关闭。
- 已有部署的信源不会被 seed 覆盖，需运行收回脚本。脚本默认只打印计划，加 `--apply` 后逐个调用管理员信源更新函数，写入审计日志并排队重建该来源的全部公开出口（网页、原文切换、Markdown、API、RSS）：

```shell
node --env-file=.env scripts/revoke-unlicensed-fulltext.ts
node --env-file=.env scripts/revoke-unlicensed-fulltext.ts --apply
```

- 数据库中已有的正文和译文保留，只是不再公开；以后某个来源取得书面许可或明确的开放许可时，先在 `industry/fulltext.ts` 记录 URL 范围、署名和许可证据，再在后台打开它的开关，已有译文可直接复用。

网站开关与版权许可记录分别保存：开关打开不等于获得许可。公众号、付费墙内容不会因为技术上抓得到就获得全文展示。
