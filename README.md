# RFID 热点

面向 RFID 行业研究的中文热点站。追踪 RAIN RFID、HF/NFC、Ambient IoT、商品身份、库存数据与智能包装，优先读取厂商和标准组织的原始材料，补充行业媒体报道。

代码仓库：[duguwuji/rfidhot](https://github.com/duguwuji/rfidhot)。npm 工作区使用 `@rfidhot/*`。

## 当前配置

- 五类栏目：技术产品、应用部署、企业动态、标准法规、研究方法。
- 56 个主题，覆盖 31 家企业与机构，以及技术方向和内容形态。
- 33 个信源入口，30 个默认启用，每天抓取两次（每 12 小时一次）；GS1 全球文章、3GPP 和 Walmart 待访问或解析验证后启用。
- 中文标题与摘要、双次独立评分、事件归组、每日北京时间 08:00 日报，以及 RSS、公开 API 和 MCP。
- 当前部署启用的信源均开放网站全文，精选正文由后台自动翻译为中文并提供原文切换，见 [全文说明](docs/fulltext.md)。模型榜和 Codex 重置监控关闭。

## 跑起来

需要 Node.js 24.11+、PostgreSQL 16+（支持 LZ4），或 Docker Compose，以及 OpenAI 兼容的模型接口。

按 [部署文档](docs/deploy.md) 初始化环境、迁移数据库和启动 API、worker、网页。先保持采集、模型、推送安全阀关闭，验证信源和模型配置后再开启。

RFID 配置、已验证信源及上线待办见 [RFID 交接说明](docs/rfid.md)。首次启动会导入行业包；已有站点的信源不会被 seed 覆盖，迁移时需在后台停用旧 AI 信源并处理旧内容。

## 检查

```bash
npm ci
npm run typecheck
DATABASE_URL=postgres://…/rfidhot_test node scripts/migrate.ts
DATABASE_URL=postgres://…/rfidhot_test npm test
npm run build -w @rfidhot/web
node --test apps/web/tests/*.test.ts
node scripts/smoke.ts --base http://localhost:3000
```

测试必须使用空的、以 `_test` 或 `_ci` 结尾的隔离库。开发期间关闭外部采集、模型和推送；测试内需要调用的提供方使用本地 stub。

## 文档与来源

[行业包](industry/README.md) · [定制流程](docs/customize.md) · [信源](docs/sources.md) · [精选校准](docs/selection.md) · [部署](docs/deploy.md)

基于 [AIHOT 开源框架](https://github.com/KKKKhazix/AIHOT) 定制，保留原有发布层、预算熔断、安全边界及 MIT 许可。上游版权与致谢见 [LICENSE](LICENSE) 和 [NOTICE](NOTICE)。站点品牌使用独立的 RFID 热点标识，图形字体许可见 [FONT-NOTICE](industry/brand/FONT-NOTICE.md)。
