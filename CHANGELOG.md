# Changelog

## 1.0.0

- 首个版本。
- 设置页「版本更新」：显示运行中/已安装/最新版本，自动检查 GitHub 发布。
- 一键下载并安装 `deepseek-harness` 的 Linux `.deb`（rpm 系统走 `dnf`/`rpm`），
  通过 `pkexec` 弹出系统授权；失败时给出可复制的手动命令。
- 下载后校验包内版本号，记录 SHA-256；支持取消、进度显示、盘空间检查。
- 环境自检（pkexec/PackageKit/dpkg/缓存/磁盘/桌面总线）与「测试授权」。
- Agent 工具 `linux_app_update`（`status` / `check`），安装动作仅限用户在界面操作。
