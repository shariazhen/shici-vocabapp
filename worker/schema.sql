-- Web Push 订阅（每台设备一行）
CREATE TABLE IF NOT EXISTS subs (
  endpoint    TEXT PRIMARY KEY,
  sub         TEXT NOT NULL,
  token       TEXT,
  tzOffset    REAL,
  activeStart INTEGER,
  activeEnd   INTEGER,
  intervalMin INTEGER,
  updatedAt   INTEGER
);
-- 定时任务每 30 分钟要全表扫一次，设备多了加这个索引
CREATE INDEX IF NOT EXISTS idx_subs_window ON subs (activeStart, activeEnd, intervalMin);

-- 多设备同步：一个口令一行，整包 JSON
CREATE TABLE IF NOT EXISTS blobs (
  token     TEXT PRIMARY KEY,
  data      TEXT NOT NULL,
  updatedAt INTEGER
);

-- 可选：导入 ECDICT 后 /lookup 才能查任意词的中文
CREATE TABLE IF NOT EXISTS dict (
  word        TEXT PRIMARY KEY,
  phonetic    TEXT,
  pos         TEXT,
  translation TEXT
);
