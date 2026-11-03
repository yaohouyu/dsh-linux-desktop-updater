# DeepSeek Harness Linux 桌面版更新插件（dsh-linux-desktop-updater）

给从 [wenyinos/dsh-desktop-linux](https://github.com/wenyinos/dsh-desktop-linux) 安装的
DeepSeek Harness Linux 桌面版补上「检查更新 / 一键更新」能力。

官方 Linux 安装包（`.deb` / `.rpm`）刻意不带应用内自动更新，升级只能自己下载新包再
`apt install`。这个插件把这条链路做成 Harness 里的一个设置页 + 一个 Agent 工具：

- 读取本机已安装的版本（`dpkg-query`，rpm 系统用 `rpm -q`，读取失败时回退到
  `resources/app.asar` 里的 `package.json`）；
- 从 GitHub Releases 的 Atom 源读取 `dsh-vX.Y.Z-rc.N` 最新版本（不走 API，避免
  未登录的 60 次/小时限流），并推导出与本机架构匹配的安装包地址；
- 把安装包下载到 `$DSH_HOME/app-updater/downloads/`，边下边算 SHA-256，下载完成后用
  `dpkg-deb --field` / `rpm -qp` 校验包内版本号；
- 通过 **pkexec + apt-get**（必要时退回 **pkcon / PackageKit**）安装，系统会弹出一次
  polkit 授权窗口；安装后提示重启应用；
- 授权失败时给出可复制的 `sudo apt install …` 手动命令；
- 设置页提供环境自检（pkexec、PackageKit、dpkg、缓存目录、磁盘空间、桌面总线）。

## 相关仓库与致谢

- **Linux 安装包来源**（本插件只读取它的 GitHub Releases，不包含也不修改它的代码）：
  [wenyinos/dsh-desktop-linux](https://github.com/wenyinos/dsh-desktop-linux)
- **上游项目**：[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)
- 本插件是独立的第三方工具，与上述仓库的维护者没有隶属关系；安装包未签名，
  升级前请自行确认来源与版本。

## 安装

两种方式任选其一。

**1）从本地目录安装（开发/自用）**

```text
plugin_manager install_bundle  target=/home/yaohouyu/桌面/dsh-plugins/dsh-linux-desktop-updater
```

**2）从 GitHub 安装**

```bash
dsh plugin --profile desktop add github:yaohouyu/dsh-linux-desktop-updater
```

安装后在 **设置 → 插件** 里能看到 `dsh-linux-desktop-updater`，并在 **设置 → 版本更新** 出现页面。

> 本目录以 `link:` 方式登记进 profile，所以目录需要保留；移动目录后要卸载再按新路径重装。
> 桌面版没有 F5 刷新快捷键：安装/更新客户端后按 **F12 → Console → `location.reload()`**，
> 或完全退出 DeepSeek Harness 再重新打开。

## 使用

1. 打开 **设置 → 版本更新**（Settings → App Updates）。
2. 页面会自动检查一次最新版本；也可以点「检查更新」。
3. 有新版本时点「下载并安装」：
   - 先下载 `.deb`（约 285 MB，下载进度会显示百分比）；
   - 然后弹出系统授权窗口，输入管理员密码；
   - 完成后关闭并重新打开 DeepSeek Harness。
4. 已是最新版本时按钮为禁用状态。
5. 「打开发布页」直达 GitHub Releases，可查看发布说明或手动下载。
6. 「环境自检 → 测试授权」会执行一次 `pkexec /usr/bin/true`，只用于确认当前桌面会话
   能弹出 polkit 授权窗口（不安装任何东西）。

Agent 侧还有一个工具 `linux_app_update`，支持：

- `action=status`：只读本地版本（运行中 / 已安装 / 上次检查到的最新版本）；
- `action=check`：额外联网刷新 GitHub 最新发布。

安装动作只保留给用户（UI 点击 + 系统授权），Agent 不能代替用户授权。

## 安全边界

- 上游 Linux 包**未签名、也没有发布校验和**，所以只能依赖 HTTPS 传输 + 包内版本号校验；
  下载后写入磁盘的 SHA-256 会显示在状态里，便于留档。
- 插件只接受本仓库 `wenyinos/dsh-desktop-linux` 发布页上、命名符合
  `deepseek-harness-<version>-linux-<arch>.deb|rpm` 的资产；只接受 `dsh-vX.Y.Z` 或
  `dsh-vX.Y.Z-rc.N` 标签。
- 不会写入 `/opt`、不会自行 `dpkg -i` 无依赖安装、不会自动安装；每次安装都必须经过
  polkit 授权。
- 下载和安装都由用户点击触发，插件不做后台自动升级。

## 故障排查

| 现象 | 处理 |
| --- | --- |
| 检查更新报网络错误 | 需要能访问 `github.com`；代理环境下请给应用进程设置 `HTTPS_PROXY`。 |
| 安装时没有弹授权窗口 | 确认桌面会话里有 polkit 认证代理（GNOME 自带）；可点「测试授权」验证。失败时会显示手动命令。 |
| `pkexec` 不存在 | 插件会尝试 `pkcon install-local`；若也没有，复制手动命令执行。 |
| 安装成功但版本没变 | 查看「更新日志输出」；确认包管理器没有被锁（`apt` 正在运行）。 |
| 更新后插件打不开/报错 | 新版 Harness 可能调整了插件 API。到 Plugin Manager 卸载后按本文档重新安装本插件即可。 |
| 磁盘空间不足 | 下载目录在 `$DSH_HOME/app-updater/downloads/`，需要约 600 MB 空闲；删掉旧的 `.deb` 再试。 |

## 验证记录

已在当前环境（Ubuntu 24.04 GNOME + DeepSeek Harness 0.2.1~rc.5，deb 安装）验证：

- 设置页「版本更新」正常渲染，自动检查后显示「运行中版本 0.2.1~rc.5 / 已安装包 0.2.1~rc.5（dpkg）/
  最新版本 0.2.1-rc.5 / 已是最新版本」；
- Host 侧版本读取（`dpkg-query`）、GitHub Atom 解析、安装包 URL 推导均正常，对
  `deepseek-harness-0.2.1-rc.5-linux-amd64.deb` 的 HEAD 请求返回 200（285 MB）；
- 版本比较（含 `0.2.1~rc.5` 与 `0.2.1-rc.5` 等价、rc 序号比较）通过；
- 安装包校验（`dpkg-deb --field Version`）在本机缓存包上通过；
- 「环境自检 → 测试授权」成功弹出系统 polkit 授权窗并确认，说明
  `pkexec + apt-get` 的安装提权链路可用。

**未实测的部分**：真正执行一次“从旧版升级到新版”的完整安装——因为当前仓库最新发布就是
已安装的 0.2.1-rc.5，没有更新版本可用。下一个 `dsh-v*` 发布后，点「下载并安装」即可
完成真实升级；若届时出错，页面会显示失败原因和可复制的手动安装命令。

## 文件

| 文件 | 作用 |
| --- | --- |
| `index.js` | Host 半：版本检测、GitHub 解析、下载、pkexec/pkcon 安装、`/api/dsh-linux-desktop-updater/*` 路由、`linux_app_update` 工具 |
| `client.js` | Client 半：设置页「版本更新」 |
| `cordis.patch.yml` | bundle patch，插入 `dsh-linux-desktop-updater` 这一行 |
| `locale/en.json`、`locale/zh.json` | Plugin Manager / 插件列表里的标题与描述 |
| `icon.svg` | 插件图标（原创） |
| `package.json` | bundle + client 清单 |

## 卸载

```text
plugin_manager remove_bundle  target=dsh-linux-desktop-updater
```

下载缓存可手动删除：`rm -rf ~/.dsh/app-updater`。

## 说明

- 只支持 Linux 桌面（`.deb`/`.rpm`）；macOS / Windows 官方包自带更新器，不需要本插件。
- 本插件依赖当前 Harness 的 `connection.fetch` / `slots` / `locale` / `tools` 接口；
  Harness 大版本升级后如出现不兼容，按「故障排查」重新安装即可。
