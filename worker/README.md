# 拾词 · 后端

Cloudflare Worker，免费额度内。负责四件事：在线查词、AI 补助记、Web Push 定时推送、多设备同步。

## 部署（约 10 分钟，一次性）

前置：一个 Cloudflare 账号（免费，不用信用卡），本机装了 Node。

```bash
cd worker
npm install
npx wrangler login                 # 浏览器登录

# 1) 建 D1 数据库
npx wrangler d1 create shici
#    把输出里的 database_id 填进 wrangler.toml

# 2) 建表
npm run db:init

# 3) 生成 VAPID 密钥（推送身份）
npm run vapid
#    Public Key  → 填进 wrangler.toml 的 VAPID_PUBLIC_KEY，
#                   同时填进前端 shici/config.js 的 VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
#    （把 Private Key 粘进去回车，不要提交到仓库）

# 4) 发布
npm run deploy
#    记下地址，如 https://shici.你的子域.workers.dev
#    填进前端 shici/config.js 的 API_BASE，然后重新发一次前端
```

验证：

```bash
curl https://你的地址/health                      # {"ok":true,...}
curl "https://你的地址/lookup?word=fulfillment"    # 带中文释义
curl "https://你的地址/enrich?word=onboarding"     # AI 生成的助记与例句
```

## 本地自测（不用部署）

```bash
node test.mjs     # 19 条：推送时段跨时区判断 + VAPID 签名验签
```

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 存活检查 |
| GET | `/lookup?word=` | 查词：内置中文词典 → D1 `dict`(ECDICT) → 公共英文词典兜底 |
| GET | `/enrich?word=` | 用 Workers AI 生成助记 / 搭配 / 地道二选一 / 场景填空 |
| POST | `/subscribe` | 存订阅（subscription, token, tzOffset, activeStart, activeEnd, intervalMin）；`?remove=1` 删除 |
| POST | `/sync` | 多设备同步（token, words[]），按 `updatedAt` 后写入胜出 |
| — | cron 每 30 分钟 | 遍历订阅，在各自活跃时段内发「无载荷」推送 |

## 关于费用

全部在免费额度内：Workers 每天 10 万次请求、Cron 触发、D1 免费额度、
Workers AI 每天有免费配额。个人自用绰绰有余。

`/enrich` 用的是 Workers AI（`@cf/meta/llama-3.1-8b-instruct`），**不需要任何 API key**，
只要 `wrangler.toml` 里有 `[ai] binding = "AI"`。不想要就删掉那两行，
`/enrich` 会返回 501，App 里只是自己加的词不自动补助记，其余不受影响。

## 推送时段是怎么判断的

cron 固定每 30 分钟跳一次，但推不推由 `shouldFire()` 按**每台设备**的时区、
活跃时段、间隔现算。所以时段和间隔在 App 设置里改就行，不用动 cron。
跨时区正确性有单测覆盖（北京 / 洛杉矶 / 跨零点 / 60 分 / 120 分）。

## 让中文查词覆盖更全（可选）

内置词典只有起步的 50 词。想查任意词都带中文，导入开源英汉词典 ECDICT：

1. 下载 `ecdict.csv`（字段含 word / phonetic / translation / pos）
2. 转成 insert 语句分批导入 `dict` 表：
   ```bash
   npx wrangler d1 execute shici --remote --file=ecdict-part1.sql
   ```

数据量大、非必需。先用起来，需要时再导。
