# Google Cloud 部署

使用一台专用 Compute Engine 虚拟机运行现有 Docker Compose：Debian 13、
`e2-medium`（4 GB 内存）、50 GB 平衡持久磁盘。网站由 Caddy 提供 HTTPS，
PostgreSQL 和 API 不开放公网端口。此方案是单机部署，升级和故障期间可能中断。

`deploy/gcp-startup.sh` 安装 Docker、检出指定提交、生成仅 root 可读的 `.env`，
并启动网站。管理员密码只保存在服务器的 `/opt/rfidhot/.env`，不会写入启动日志、
实例元数据或仓库。首次部署关闭采集、模型、飞书和 IndexNow 安全阀；
没有模型 Key 也能验证网站、RSS、公开 API 和 MCP 的空状态。

## 创建资源

先确认账号、已启用计费的项目、地区和预算，再创建资源。不要复用其他服务的实例。
实例元数据需要两个非敏感值：`rfidhot-domain`（访问域名）和
`rfidhot-revision`（完整的 40 位 Git 提交 SHA）；启动脚本通过
`--metadata-from-file=startup-script=deploy/gcp-startup.sh` 传入。

建议使用专用 VPC，只允许公网 TCP 80/443 到网站实例；SSH 只允许
Google IAP 的 `35.235.240.0/20`，通过 `gcloud compute ssh --tunnel-through-iap`
管理。实例无需 Google Cloud 服务账号或 API 权限。
启动磁盘关闭自动删除，并建立每日快照、保留 7 天。快照用于灾难恢复，
不能代替应用的数据库备份。预算提醒不会自动限制费用，流量、IPv4、
磁盘快照和模型服务均需计入实际费用。

## Cloudflare 域名

为子域名添加 A 记录，指向该虚拟机的区域静态 IPv4。首次验证先用“仅 DNS”，
让 Caddy 申请证书；验证 HTTPS 后可启用 Cloudflare 代理，SSL/TLS 使用
`Full (strict)`。启用代理后需核对访客 IP、登录限流和缓存规则；不要缓存
`/admin`、登录响应或带 Cookie 的请求。

## 验证与启用

在 VM 上查看启动进度：

```bash
sudo journalctl -u google-startup-scripts.service --no-pager -n 100
cd /opt/rfidhot
sudo docker compose ps -a
sudo docker compose logs --tail 100 api worker web caddy
sudo docker compose exec -T web node scripts/smoke.ts --base https://你的域名
```

通过 SSH 编辑 `.env`，填模型地址、名称和 API Key；不要把 Key 放在命令行、
实例元数据或聊天中。按 [RFID 交接说明](rfid.md) 验证信源、预算、运营资料与条款，
然后才开启 `COLLECT_ENABLED` 和 `MODEL_CALLS_ENABLED`。采集周期为北京时间每天 07:30 和 19:30 启动采集。
环境变量修改后运行 `sudo docker compose --profile https up -d`。

更新和数据库备份继续按 [部署文档](deploy.md) 操作；VM 上的检出固定到部署提交，
更新时先 `sudo git fetch origin`、再检出审核过的新提交。不要删除 Docker 数据卷。
