# 拾词 · shici

跨境电商 / 达人 BD 的英语速记本。离线优先的 PWA，装到 iPhone 主屏当原生 App 用。

**线上地址**：https://shariazhen.github.io/shici-vocabapp/

## 功能

- **今日** — 新词闪卡，右甩认识 / 左甩忘了 / 轻点翻面。背面有释义、例句朗读、
  速记（词根拆解 + 联想钩子 + 易混词）和常用搭配。
- **练习** — 七种题型：中译英、听音拼写、听句选词、词语搭配、哪个更地道、
  场景填空、跟读打分。
- **词库** — 50 个电商/外贸/达人 BD 场景词，可搜索、收藏、自己加词。
- **统计** — 五维能力面板（认词/拼写/听力/地道/口语）+ 最弱项建议。
- **设置** — 每日新词量、推送时段、多设备同步、导入导出。

学习数据全在手机本地（IndexedDB），不配后端也能完整使用。

## 目录

```
.                      前端，GitHub Pages 从仓库根目录发布
├─ index.html
├─ app.js              全部逻辑
├─ seed.js             起步 50 词
├─ config.js           ← 部署后端后填这里
├─ sw.js               Service Worker
├─ fonts/              自托管字体，不请求外部域
└─ worker/             后端（Cloudflare Worker，可选）
```

详细说明见 [`DEPLOY.md`](./DEPLOY.md)，后端见 [`worker/README.md`](./worker/README.md)。
