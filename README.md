# TRSS-Yunzai Proxy Plugin

基于 mihomo 的 TRSS-Yunzai 代理管理插件。支持 Windows 和 Linux 的系统代理与 TUN，可在机器人、锅巴或内置 WebUI 中管理核心、订阅和节点。

## 🐬 安装教程

先安装并配置 [TRSS-Yunzai](https://github.com/TimeRainStarSky/Yunzai)，然后在 Yunzai 根目录执行以下命令。

```bash
git clone --depth=1 https://github.com/LiuYunLingNai/Proxy-Plugin.git ./plugins/Proxy-Plugin
```

如果无法直连 GitHub，可以改用镜像地址。

```bash
git clone --depth=1 https://ghp.lyln114514.top/https://github.com/LiuYunLingNai/Proxy-Plugin.git ./plugins/Proxy-Plugin
```

安装后启动或重启 Yunzai。仓库包含构建后的 WebUI，日常使用时无需构建前端。锅巴是可选的配置入口。

### 平台要求

| 平台 | 系统代理 | TUN |
| --- | --- | --- |
| Windows | 修改运行 Yunzai 的用户的 WinINet 代理设置，对读取该设置的应用生效 | 核心需有管理员权限。可开启 `core.windowsElevate`，启动时确认 UAC 提示 |
| Linux | 支持 GNOME 和 KDE。以目标桌面用户运行 Yunzai，并确保能够访问该用户的 D-Bus 会话 | 需要 `/dev/net/tun`，以及允许核心配置网卡和路由的 `CAP_NET_ADMIN` 权限 |

Linux 无桌面环境可用 TUN，也可让应用直接使用本机混合代理端口，默认地址为 `127.0.0.1:17890`。

## 使用教程

### 快速上手

1. 用主人账号向机器人发送 `#代理部署`。插件会按系统和架构下载缺失的 mihomo，校验配置并启动核心。默认关闭系统接管。
2. 发送 `#代理web` 获取登录链接，在 WebUI 的「订阅」页添加完整的 mihomo YAML 订阅。也可以私聊发送 `#代理订阅 添加 "常用线路" https://example.com/sub.yaml`，将示例 URL 换成自己的订阅地址。使用本地文件时，私聊发送 `#代理配置导入 <本地 YAML 路径>`。
3. 需要让应用走代理时，发送 `#代理接管 系统` 或 `#代理接管 tun`，也可以在 WebUI 首页选择。
4. 发送 `#代理状态` 查看核心、接管方式和当前订阅。

### 指令一览

所有指令仅主人可用。添加订阅地址、导入本地配置和查看日志请使用私聊。

| 指令 | 用途 |
| --- | --- |
| `#代理帮助` | 动态渲染代理指令总览 |
| `#节点管理` | 查看代理组、切换节点和测速的帮助图 |
| `#订阅管理` | 查看添加、切换和更新订阅的帮助图 |
| `#代理部署` / `#代理核心启动` | 下载缺失的核心并启动 |
| `#代理核心停止` / `#代理恢复` | 恢复插件接管的系统代理设置并停止核心 |
| `#代理核心重启` | 重启 mihomo 并应用已保存的配置 |
| `#代理接管 系统` / `#代理接管 tun` / `#代理接管 关闭` | 切换系统接管方式 |
| `#代理模式 规则` / `#代理模式 全局` / `#代理模式 直连` | 切换 mihomo 路由模式 |
| `#代理组` / `#代理节点 <完整组名>` | 查看代理组及组内节点 |
| `#代理切换 "组名" "节点名或关键词"` | 选择节点。关键词须唯一匹配 |
| `#代理测速 <完整组名>` | 生成测速图，显示可用节点数、彩色延迟和当前节点，保持当前选择 |
| `#代理订阅` | 生成订阅列表图，显示运行状态，以及订阅服务提供的流量和到期时间 |
| `#代理订阅 添加 "名称" <URL>` | 下载、校验并保存订阅 |
| `#代理订阅 切换 <名称或序号>` | 启用指定订阅 |
| `#代理订阅 更新 <名称或序号>` | 刷新指定订阅。省略名称或序号时更新全部 |
| `#代理订阅 改名 "原名称或序号" "新名称"` | 修改订阅名称 |
| `#代理订阅 删除 <名称或序号>` | 删除订阅。正在使用的订阅需先切换或停止核心 |
| `#代理配置导入 <本地 YAML 路径>` | 校验并启动本地配置。相对路径以 Yunzai 根目录为准 |
| `#代理配置检查` / `#代理配置回滚` | 校验配置或恢复上一份可用配置 |
| `#代理状态` | 生成状态图，查看核心、接管、路由和正在使用的订阅 |
| `#代理诊断` / `#代理日志` | 查看冲突、诊断细节和最近日志 |
| `#代理web [有效分钟]` / `#代理下线` | 生成临时访问链接或撤销 WebUI 会话 |

## WebUI

发送 `#代理web` 获取临时链接，默认有效期 30 分钟。可用 `#代理web 60` 自定义时长。在群里执行时，机器人会尝试私聊发送链接。链接包含访问令牌，请勿转发。

| 页面 | 功能 |
| --- | --- |
| 主页 | 查看核心状态、实时流量和内存，启动或停止核心，切换接管方式 |
| 代理 | 浏览代理组和节点，切换节点，单节点或批量测速，管理代理提供者 |
| 连接 | 查看实时连接、搜索和筛选，查看连接详情，关闭单条或全部连接 |
| 日志 | 查看历史和实时日志，筛选、暂停或导出 |
| 规则 | 按类型或关键字筛选规则，以卡片查看匹配条件和策略，编辑、排序或批量编辑规则 |
| 订阅 | 添加、编辑、切换、更新和删除订阅，查看缓存及订阅服务返回的流量和到期信息 |
| 配置 | 编辑 YAML 和核心选项，管理 DNS 缓存、Geo 数据及 mihomo 版本 |

测速结果低于 200 ms 显示绿色，200–499 ms 显示橙色，500 ms 及以上或测速失败显示红色。规则、配置和订阅页优先显示已保存内容，再补充运行状态。后台刷新会保留正在编辑的规则和配置。

### 配置 WebUI 的端口和挂载方式

默认挂载到 Yunzai 的 HTTP 服务，沿用 Yunzai 的端口，访问路径为 `/proxy-plugin/`。可在锅巴或 WebUI「配置」中关闭挂载，改用单独的监听地址和端口。也可直接编辑 Yunzai 根目录下的 `config/Proxy-Plugin.yaml`。

```yaml
webui:
  enabled: true
  mountToYunzai: false
  host: 127.0.0.1
  port: 19100
  publicUrl: ""
```

此示例在本机监听 `http://127.0.0.1:19100/proxy-plugin/`。需要从局域网访问时，可将 `host` 设为 `0.0.0.0`，将 `publicUrl` 设为浏览器能访问的基础地址，例如 `http://192.168.1.10:19100`。`publicUrl` 用于生成链接，填写时省略 `/proxy-plugin/` 和令牌。通过反向代理访问时，转发 `/proxy-plugin/` 下的页面、接口和实时流。

修改 WebUI 开关、挂载方式、地址或端口后，**重启 Yunzai**，再用 `#代理web` 获取新链接。`enabled: false` 会关闭 WebUI，机器人仍可管理核心。独立监听也由 Yunzai 进程提供。


### 配置 mihomo 下载源

插件会自动选择 Windows 或 Linux 对应的 x64 或 arm64 发布包，默认从 GitHub 下载。可在锅巴设置「GitHub 下载源」，也可填写 `download.mirrors`。下载源按列表顺序尝试，空字符串表示直连。镜像前缀须以 `/` 结尾，服务须支持 GitHub Release API 和构建产物地址。

```yaml
download:
  mirrors:
    - ""
    - "https://ghp.lyln114514.top/"
  timeoutSeconds: 120
```

示例先直连，再尝试镜像。要优先使用镜像，可将它移到第一项。已经有可用核心时会复用本地文件。升级或切换版本请使用 WebUI「配置」中的核心版本功能。已有二进制也可通过 `core.path` 指定。

## 自动更新

- **订阅刷新**在 Yunzai 运行时执行。`subscription.autoUpdateHours` 默认 `0`，表示关闭。可为每条订阅单独设定周期，留空继承全局值，填 `0` 则只关闭这一条的自动刷新。
- **核心启动**可通过 `core.autoStart: true` 跟随 Yunzai。运行中的核心会接受定期健康检查，异常时按 `health.restartAttempts` 重试。
- **插件更新**可在 Yunzai 根目录运行 `git -C plugins/Proxy-Plugin pull --ff-only`。更新后重启 Yunzai。

## 配置说明

锅巴和 WebUI 使用 Yunzai 根目录下的同一份 `config/Proxy-Plugin.yaml`。

### 核心和路由

| 字段 | 用途与取值 |
| --- | --- |
| `core.path` | 已有 mihomo 可执行文件的路径，可填绝对路径或相对 Yunzai 根目录的路径。留空时使用 `data/Proxy-Plugin/bin/`，文件缺失时自动下载。 |
| `core.version` | 自动下载时选用的发布版本。可填 `latest` 或 GitHub 的具体版本标签。已有核心会继续复用，切换已安装版本可用 WebUI 的核心版本功能。 |
| `core.mixedPort` | 应用连接的本机混合代理端口，同时支持 HTTP 和 SOCKS。 |
| `core.controllerPort` | mihomo 本机控制接口的端口，插件用它查询状态、切换节点和读取连接等。接口使用插件生成的密钥。 |
| `core.autoStart` | 加载插件时是否自动启动核心。关闭时可发送 `#代理核心启动` 手动启动。 |
| `core.windowsElevate` | Windows 使用 TUN 时，是否通过 UAC 以管理员权限启动 mihomo。开启后需确认 UAC 提示。 |
| `core.startupTimeoutSeconds` | 启动 mihomo 后等待控制接口就绪的时间，范围为 3–120 秒。 |
| `core.logLevel` | 核心日志详细程度。`silent` 静默，`error` 记录错误，`warning` 加入告警，`info` 加入运行信息，`debug` 输出更详细的调试信息。 |
| `takeover` | 流量进入 mihomo 的方式。`off` 关闭系统接管，`system` 设置当前用户的系统代理，`tun` 通过虚拟网卡接管流量。 |
| `mode` | mihomo 收到流量后的转发方式。`rule` 按规则匹配，`global` 使用 `GLOBAL` 代理组的选择，`direct` 直接连接。 |

`core.mixedPort` 和 `core.controllerPort` 仅监听本机，须使用不同的端口，取值均为 1024–65535 的整数。修改端口、核心路径或接管设置后，可用 `#代理核心重启` 应用。`core.autoStart` 在插件下次加载时读取。日志等级和路由模式的含义见 [mihomo 全局配置](https://wiki.metacubex.one/config/general/)。


请在锅巴、WebUI 或配置文件中保存长期设置，生成的 `runtime/config.yaml` 会在应用配置时重新写入。备份或分享配置时留意订阅地址、节点凭据和控制密钥。

## 故障排查与恢复

| 现象 | 处理方法 |
| --- | --- |
| 检测到其他 mihomo 或 Clash 核心 | 发送 `#代理诊断` 查看进程，在原程序中停止核心，再启动插件的核心 |
| 代理端口或控制端口被占用 | 在锅巴修改对应端口后重试 |
| Linux 系统代理无法启用 | 确认 Yunzai 在目标桌面用户的 D-Bus 会话下运行，按需在锅巴指定 GNOME 或 KDE |
| TUN 启动失败 | 检查 Windows 管理员权限，或 Linux 的 `/dev/net/tun` 与 `CAP_NET_ADMIN` |
| WebUI 链接打不开 | 检查挂载模式对应的 Yunzai HTTP 地址或独立监听地址。修改设置后重启 Yunzai，重新生成链接 |
| 更新订阅后无法正常使用 | 用 `#代理配置检查` 或私聊 `#代理日志` 排查，必要时用 `#代理配置回滚` 恢复 |

停用代理时发送 `#代理恢复`。退出 Yunzai 后，mihomo 仍可能继续运行。如果机器人不可用，在 Yunzai 根目录用原用户及所需权限执行恢复脚本。

```bash
node plugins/Proxy-Plugin/scripts/recover.mjs
```

恢复脚本只处理插件记录并能确认归属的核心与系统代理设置。遇到第三方代理修改时，按脚本提示检查当前设置。恢复后可检查 TUN 网卡、路由和目标应用的实际连通性。

## 开发

在 `plugins/Proxy-Plugin/` 目录执行以下命令。前端源码在 [`webui/src/`](webui/src/)，构建输出在 `webui/dist/`。测试从插件目录运行，依赖父级 Yunzai 环境。

```bash
npm --prefix webui ci
npm run check:web
npm run build:web
npm test
```

## 相关链接

- [TRSS-Yunzai](https://github.com/TimeRainStarSky/Yunzai)
- [mihomo](https://github.com/MetaCubeX/mihomo)
