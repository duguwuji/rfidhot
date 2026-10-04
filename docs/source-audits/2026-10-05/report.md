# 文本候选信源验证与评估

验证日期：2026-10-05，北京时间约 04:00–04:20。验证范围为 GS1 China、Auburn RFID Lab、Hana RFID、HID、Schreiner、FDA，以及 MMH、SCMR、Arizon。结论：四个入口通过采集验证，其中 MMH 为媒体备选；SCMR 有条件可用；其余四个需要暂缓自动接入。

本机 Node.js 24.19.0 和 Google Cloud 网站 API 容器分别执行只读预览，使用仓库现有的 guardedFetch、fetchRss、fetchWebList / fromHtml、fetchDetail。核对访问状态、标题、唯一文章链接、发布日期及三篇详情样本。未调用 collectSource，未写入运营数据库，未调用模型、Jina 或其他付费采集服务，未修改线上采集和模型开关。

[结构化证据](evidence.json)记录两个环境的结果；[候选配置](candidates.json)只供审核，不是 industry/sources.json 或 seed 输入，全部保持停用。候选数是解析结果，不是近期新闻数、入选数或未来可用性保证。

| 来源 | Google Cloud 结果 | 日期与样本核验 | 评估与建议 |
|---|---|---|---|
| [Hana 技术博客](https://hanarfid.com/insights/) | RSS 200，原始 10 条，Blog 分类 4 条 | 4 条有日期；核对前三篇详情，标题和发布日一致；最新 2026-09-14 | 推荐。只收 Blog 和 /insights/blog/ 路径；News 暂缓 |
| [Schreiner RFID/NFC](https://forum.schreiner-group.com/en/tag/rfid-nfc-en/) | 专题 RSS 200，10 条 | 10 条有日期；三篇详情标题和精确日期一致；最新 2026-05-26 | 推荐。补充制药、工业、DPP、复杂环境标签；厂商观点保留归因 |
| [Arizon 新闻](https://www.arizonrfid.com/blog) | HTML 200，排除 Events 后 10 条 | 10 条列表日期；三篇详情标题及发布日一致，JSON-LD 提供含时区的时间 | 推荐但优先级较低。最近网页发布日为 2026-02-25，更新较慢；产品认证等声明仍需回查原文 |
| [MMH](https://www.mmh.com/) | HTML 200，15 个唯一文章候选 | 15 条日期；前三篇详情标题、发布日一致，正文可提取；最新 2026-10-02 | 技术通过，媒体备选。用网页入口，过滤泛仓储、人事、机器人消息 |
| [SCMR](https://www.scmr.com/) | RSS 200，50 条；网页及前三篇详情均 403 | 50 条订阅日期，最新 2026-10-02；订阅含内容，无法独立复核三篇详情 | 有条件可用。可考虑仅订阅材料，但内容宽泛；本次未列为默认接入候选 |
| [Auburn RFID Lab](https://rfid.auburn.edu/news/) | HTML 200，当前选择器抽取 9 个候选 | 列表均无日期；三篇详情仅一篇按当前规则读到明确日期 | 暂缓整站自动接入。不同下属站点需要不同日期规则；缺日期文章应保留为研究资料 |
| [FDA 食品追溯专题](https://www.fda.gov/food/food-safety-modernization-act-fsma/fsma-final-rule-requirements-additional-traceability-records-certain-foods) | HTML 200；FSMA 更新页也可访问 | 专题页日期标为 Content current as of；更新目录混合多年法规、指南及导航 | 作为监管核验资料保留。需专门的公告入口与原始发布时间规则后再自动接入 |
| [GS1 China](https://www.gs1cn.org/) | HTTPS 连接失败：证书过期；HTTP 200 但为 JavaScript 页面壳 | 当前静态入口没有可解析的文章卡片和日期 | 暂缓。待有效 HTTPS 和公开文章列表 / 接口验证后再接入 |
| [HID 新闻中心](https://newsroom.hidglobal.com/press-releases) | 列表和公开 RSS 均 403 | 本机 RSS 可解析 6 条并核对三篇详情；云端失败 | 暂缓。不要用本机成功推断云端可采集，不绕过限制 |

**日期质量决定接入范围**

Hana 官网一篇人事公告在 RSS 和页面上标为 2026-04-15，正文通稿日期却是 2025-12-05，任职生效日为 2025-12-01。同一订阅中的多篇 News 条目集中标为 2026-04-15。这说明官网当前发布时间与原始事件/通稿时间可能不同，不能直接当作新事件。迁站或重新发布原因尚未确认，因此本次推荐只收日期核对通过的 Blog 分类，不替旧公告猜测发布时间。[公告原文](https://hanarfid.com/insights/news/hana-rfid-welcomes-tony-morris-as-vice-president-of-sales-to-advance-global-customer-programs/)

MMH 官方页面声明的 RSS 本次最新条目为 2026-09-04，而首页已有 2026-10-02 文章。RSS 可访问不代表更新及时，因此候选使用首页文章卡片；从 datePublished 的 content 属性读取含时区的列表日期，详情正文日期精度仅到日，核对时按来源当地日比较。详情样本可提取正文约 2,092–3,416 字符，但这三篇主题主要为物流设备及人事，技术通过不能代替 RFID 编辑相关性判断。

Arizon 列表只有日期；详情不含时区的 meta 和带 +08:00 的 JSON-LD 在解释上有八小时差异。候选保留列表日期并使用 datePublished JSON-LD 补充时间精度，不采用 modified 时间。新闻发布时间也不等于事件发生日：最新文章发布于 2026-02-25，正文说明相关事件为 2026-01-15。

Auburn 列表混合 rfid.auburn.edu、wire.auburn.edu、harbert.auburn.edu。NASA 合作文章详情有 .published 日期，Harbert 文章日期与作者混在同一段中，Hackathon 页面缺明确发布日期。不能把活动日期、URL 年份或版权年份填作发布日期。

FDA 食品追溯专题的页面维护日期为 2026-07-24；此字段描述页面内容维护，不是其中每个公告的发布日期。FSMA 更新页按年份归档，且含与追溯无关的其他食品安全规则。通用抓所有链接的诊断预览产生 204 条链接，包含导航和知识页面，不能作为有效新闻候选数。

**信息价值与接入顺序**

建议先审核 Hana Blog、Schreiner 专题、Arizon 新闻三个厂商入口。Hana 提供嵌体、航空行李、静电控制等技术增量；Schreiner 提供制药、工业标签和材料应用；Arizon 补充芯片/嵌体/ARC 动态，但近期更新较少。三者属于其自身产品和活动的一手来源，不能把其案例收益当作独立研究结论。

MMH 可以均衡补充行业媒体视角，但首页覆盖广泛仓储与自动化业务，需沿用已有 RFID 相关性预筛。SCMR 的订阅更新正常，但详情受限且泛供应链内容多，暂作为备选。MMH 与 SCMR 同属 Peerless Media，对同一通稿的关联转载不能简单算作两份独立证据。[出版商品牌列表](https://www.peerlessmedia.com/brands/)

GS1 China 和 FDA 的权威性价值仍然较高，接入受阻不影响它们作为标准与监管原文的参考价值。Auburn 更适合提供有明确日期、方法和测试条件的研究证据。HID 保留为等待云端访问恢复的候选。

候选配置保持每天两次（720 分钟）、首次历史导入最多 8 篇且仅最近 12 个月、网页详情每轮最多 8 次；仅公开摘要和原文链接。历史资料沿用归档规则。配置键已通过仓库的 assertSupportedConfig 校验；生产接入、预算消耗、去重入库及公开发布未在本次评估中执行。模型费用仍需由上线后的原有回执和预算熔断控制，未估算或承诺新增月费用。
