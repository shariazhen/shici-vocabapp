// ============================================================
// 拾词 · 前端配置（部署前改这里）
// ============================================================
window.SHICI_CONFIG = {
  // 你的 Cloudflare Worker 地址（部署 worker 后填），例如 'https://shici.你的子域.workers.dev'
  // 留空则：查词自动补全用公共词典兜底、推送与同步功能关闭
  API_BASE: 'https://shici.vocabapp-20260822.workers.dev',

  // Web Push 的 VAPID 公钥（用 worker 里的 npm run vapid 生成）。留空则推送订阅按钮不可用。
  VAPID_PUBLIC_KEY: 'BBNqwUcTPgpN2rrdgPiAeTjUFsw4LYKMah-Cv4fdLcXWjGpl9xVkgh7SeDdDonPQnZSxyzsWb-2J--iUI2zB1L8',

  // 多设备同步用的个人口令（两台设备填同一个即可把词库/进度同步到一起）。留空则不同步。
  SYNC_TOKEN: ''
}
