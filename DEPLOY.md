# 部署与更新

## 一、第一次推到 GitHub

在你自己的电脑上，解压我给的压缩包，进到解压出来的文件夹，然后：

```bash
git init
git add .
git commit -m "拾词 v2.1"
git branch -M main
git remote add origin https://github.com/shariazhen/shici-vocabapp.git
git push -u origin main
```

> 如果仓库里已经有东西（比如建仓库时勾了 README），`push` 会被拒。
> 两种处理：
> - 想保留远端已有内容：`git pull --rebase origin main` 之后再 `push`
> - 确定远端是空壳、直接覆盖：`git push -u origin main --force`

> 推送时要填密码的话，**不要填 GitHub 登录密码**（早就不支持了）。
> 去 GitHub → Settings → Developer settings → Personal access tokens →
> Tokens (classic) → Generate new token，勾上 `repo`，把生成的那串当密码粘进去。
> macOS 上可以 `git config --global credential.helper osxkeychain` 存起来，只填一次。

## 二、打开 GitHub Pages

1. 仓库页面 → **Settings** → 左侧 **Pages**
2. Source 选 **Deploy from a branch**
3. Branch 选 **main**，文件夹选 **/ (root)**，Save
4. 等一两分钟，页面顶部会出现地址：

```
https://shariazhen.github.io/shici-vocabapp/
```

## 三、装到 iPhone 主屏

**必须用 Safari**（Chrome 装不了 PWA）：

1. Safari 打开上面那个地址
2. 底部「分享」按钮 → **添加到主屏幕**
3. 从主屏图标打开

从主屏图标打开才算「独立 App」—— iOS 只有这种情况才允许网页推送通知。
从 Safari 标签页里打开是收不到推送的。

装好之后断网也能用：学习、练习、口语打分、统计全部离线可用。

---

## 四、以后怎么更新

### 改了代码之后

电脑上：

```bash
git add .
git commit -m "说清楚改了什么"
git push
```

推完等 1–2 分钟（GitHub Pages 要重新构建，仓库 Actions 页能看到进度）。

### 手机上怎么拿到新版本

**正常情况：直接打开 App 就是新的。**

Service Worker 对代码和页面用的是**网络优先**策略 —— 有网时每次打开都去拿最新的，
没网时才回落到缓存。所以不用清缓存、不用删了重装。

如果你刚推完就打开，可能还是旧的，原因有两个：

1. **GitHub Pages 还没构建完** —— 去仓库 Actions 页看一眼是不是还在跑
2. **App 在后台挂着没重新请求** —— 从多任务里**上划关掉 App**，再从主屏图标打开

还不行的话，App 里有个兜底：**设置 → 最底下「检查更新」**。
它会去问服务器有没有新版，有的话提示你关掉重开。那一行旁边还会显示当前版本号，
以及「页面是 v2.1、离线缓存还是 v2.0」这类提示，能直接看出卡在哪一步。

### 什么时候需要改 `sw.js` 里的版本号

一般不需要。只有这两种情况才要把 `sw.js` 顶上的 `VERSION` 加一位：

- 你**加了新文件**（比如新的字体、新图标），需要让离线缓存把它预先存下来
  —— 同时记得把文件名加进 `SHELL` 数组
- 你改了 `sw.js` 自己的缓存逻辑

### 更新会不会把学习数据弄丢

不会。词库、学习进度、练习记录都在手机的 IndexedDB 里，和代码是分开的。
更新代码不碰它们。

不过**删掉主屏图标会连数据一起删**。想保险的话，设置里「导出词库」
会生成一个带学习进度的 CSV，存到文件 App 或发给自己。

### 改词库

`seed.js` 里是起步 50 词。改完推上去之后：

- **新加的词**会自动进你的词库
- **已有的词**只会补空字段（比如原来没有助记，现在有了就补上），
  **不会重置你的学习进度**

逻辑在 `app.js` 的 `seedIfNeeded()` 里。

---

## 五、后端（可选）

不部署后端，App 的学习、练习、口语打分、统计全都正常，只是没有：

- 每 30 分钟的锁屏推送
- 加新词时的「联网查词补全」和 AI 自动补助记
- 多设备同步

要开这三项，按 [`worker/README.md`](./worker/README.md) 走一遍（约 10 分钟，
Cloudflare 免费额度内，不用信用卡）。拿到 Worker 地址和 VAPID 公钥后，
填进根目录的 `config.js`，再 `git push` 一次即可。

```js
window.SHICI_CONFIG = {
  API_BASE: 'https://shici.你的子域.workers.dev',
  VAPID_PUBLIC_KEY: 'BN...你的公钥',
  SYNC_TOKEN: ''
};
```

> `config.js` 会被推到公开仓库。里面只有 Worker 地址和 VAPID **公**钥，
> 这两样本来就是公开的，不是机密。**私钥在 Cloudflare 的 secret 里，不在仓库里。**
> 同步口令 `SYNC_TOKEN` 建议留空，改在 App 的设置里填 —— 那样只存在手机本地。
