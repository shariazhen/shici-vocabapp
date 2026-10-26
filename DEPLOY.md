# 拾词：部署与更新

本项目是静态 PWA，前端无需 npm 安装或构建。GitHub Pages 从 `main` 分支的仓库根目录发布。雅思词库、书信、段落练习、录音和成绩记录都可以在静态前端运行。

## 首次启用 GitHub Pages

1. 打开仓库 https://github.com/shariazhen/shici-vocabapp 。
2. 进入 **Settings → Pages**。
3. 在 **Build and deployment** 中选择 **Deploy from a branch**。
4. Branch 选择 **main**，目录选择 **/ (root)**，点击 **Save**。
5. 在仓库 **Actions** 中查看 Pages 构建与部署任务，等待成功后访问：

   https://shariazhen.github.io/shici-vocabapp/

如果 Pages 已按此方式配置，之后推送 `main` 会自动触发更新，无需重复设置。若已有自定义 Actions 发布流程，请先核对该流程的发布目录，不要盲目替换配置。

## 日常发布

在电脑的项目目录中，先查看改动，并确认没有私钥或其他不应公开的文件：

```bash
git status
git diff
```

提交需要发布的文件，例如：

```bash
git add app.js index.html seed.js ielts-seed.js ielts-training.js sw.js README.md DEPLOY.md tests/
git commit -m "更新雅思学习功能"
git push origin HEAD:main
```

本仓库用 HTTPS GitHub 地址。需要登录时，使用 GitHub CLI 的 `gh auth login` 或系统凭据管理器；不要将令牌写进源码或远端 URL，也不要在聊天中发送令牌。

如果远端有新提交，先获取并整合改动、解决冲突、重新验证后再推送。不要强制覆盖远端：

```bash
git fetch origin
git rebase origin/main
```

## 发布前本地检查

在仓库根目录启动静态服务器：

```bash
python3 -m http.server 8081 --bind 127.0.0.1
```

在另一终端运行浏览器回归测试（需要 Playwright 和 Chromium；测试默认寻找 `/usr/bin/chromium`）：

```bash
node tests/ielts-smoke.cjs
node tests/ielts-training.cjs
```

若 Chromium 位于其他路径，通过 `CHROMIUM_PATH` 环境变量指定。浏览器测试使用独立临时浏览器数据和模拟麦克风，不写线上学习数据。

可选后端的现有逻辑测试：

```bash
cd worker
npm test
```

## 发布后确认

1. 在 **Actions** 确认本次提交对应的 Pages 部署成功。
2. 访问网站，「今日」应出现 **进入说写训练与四科进度**，进入后可选择 9 道说写题目。
3. 保存一段练习，刷新后确认草稿还在；记录一条模考成绩，检查对应科目显示正确。
4. 在支持录音的浏览器允许麦克风，测试录音、停止、回听和下载。录音需要 HTTPS 和麦克风权限；模拟麦克风测试不替代 iPhone 真机验证。
5. 设置页应显示页面版本 **v2.3.1**。新脚本已经纳入离线缓存。

## 手机更新与离线使用

在 iPhone Safari 打开网站，通过分享菜单 **添加到主屏幕**。前端代码采用网络优先策略，字体和图标采用缓存优先策略。

若发布后仍看到旧版，先等待 Pages 构建完成，再完全关闭 App 后重新打开；也可在设置中使用 **检查更新**。本次 Service Worker 版本为 2.3.1，缓存包含雅思词库和训练模块。以后增加需离线使用的新文件时，要更新 `sw.js` 的 `SHELL` 列表和版本，并同步页面版本。

不要通过清除网站数据来更新：词库进度、训练文本、成绩和录音都存在浏览器本机。更新源码不会主动清空它们，但清除网站数据、换设备或删除主屏 App 可能造成数据丢失。重要词库先导出 CSV；说写文本与成绩需另行保存，录音可单独下载。训练数据不参与原词库云同步，CSV 也不包含训练数据。

## 可选 Cloudflare 后端

本次雅思功能发布无需重新部署 Cloudflare。`config.js` 保留原有 Worker 地址和 VAPID 公钥，没有加入私钥。

需要新建或修改查词、AI、Web Push、多设备词库同步服务时，再按 [worker/README.md](worker/README.md) 操作。注意该文档的 `db:init` 使用远端数据库，先核对 Cloudflare 账号和数据库，避免误操作。VAPID 私钥仅存放在 Cloudflare secret，不得提交进仓库。不要将个人同步口令填入公开的 `config.js`。

GitHub Pages 发布是前端部署，Cloudflare Worker 发布是后端部署；本次没有修改后端。
