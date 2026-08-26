# dsh-worktable 🖥️

<p align="center"><a href="README.md"><b>English</b></a> · 简体中文</p>

**DeepSeek Harness 的 agent 项目工作台**——侧边栏「应用抽屉」把项目变成可停靠的窗口，再加上实时监控各房间有效项目成员的内置多控制室。

## 📸 截图

| | |
|---|---|
| <img src="docs/assets/shot-2-console.png" alt="控制室主界面" width="1080"> | **🖥️ 控制室主界面** —— 默认房间也是普通可删除的房间：实时卡片网格监控该房间的有效项目成员（工作中 / 待你决定 / 已完成），蓝图网格上的玻璃拟态卡片 |
| <img src="docs/assets/shot-1-sidebar.png" alt="工作台侧边栏" width="1080"> | **🧩 工作台侧边栏** —— 应用抽屉：项目、快捷方式与可管理的控制室入口 |
| <img src="docs/assets/shot-3-workspace.png" alt="我们的项目" width="1080"> | **🪟 我们的项目** —— 每个项目打开为可停靠的分栏工作区（含旅行 Atlas 等入驻应用） |

---

## ✨ 功能导览

### 🧩 侧边栏应用抽屉

- 收纳你的自建项目（以及 dsh-travelatlas 等入驻插件项目）
- 项目支持改名 / 图标 / 排序 / 隐藏；每个项目有专属文件夹；**项目 ↔ 对话绑定**——打开项目时右侧对话窗自动切到其绑定对话
- 收起侧边栏后，每个项目变成可点击的方形小贴片（只留 emoji）
- 深蓝发光玻璃主题覆盖宿主侧栏、对话顶栏、消息画布、输入框、设置弹窗、工作台抽屉与控制室
- “设置 → 外观与背景”可分别调整 Web 主界面和侧边栏的背景层、内容玻璃与文字颜色；侧边栏支持完全独立、仅同步主题色、同步全部通用配色与背景，`dsh-usage` 硬件监控台继续使用独立主题

### 🪟 可停靠的分栏工作区

- 声明式布局预设（左栏 / 顶行 / 主网格 + 右侧对话窗）
- 可拖拽分割线、窗格标签页、按布局持久化的宽度记忆
- 内置窗格：**文件资源管理器、终端、浏览器、动画站点、自定义窗口**
- 自定义窗口：把需求发给新建或已有对话，agent 完成后产物自动挂载进对应窗口（锁死）

### 🖥️ 控制室（可管理的多控制室）

- 支持多个命名控制室（原「总览」现在也是普通控制室）：可创建、改名、复制、隐藏、归档、恢复，最后一个也可以删除
- 每个控制室只保存项目 ID、排序、规则、一条可选管理对话绑定、布局、主题和卡片偏好；项目主数据、文件、对话、Token 统计和硬件数据仍保持全局
- 全局搜索支持 `Ctrl+K` / `Ctrl+Shift+P`，覆盖控制室、项目、绑定对话和规则，并提供直接跳转描述
- 控制室配置可导出/导入为 `dsh-control-rooms-v1.json`；导入会重映射冲突 ID，不覆盖项目/会话/全局设置
- 浏览器里的 `window.__dshWorktable.controlRooms` 是由 localStorage 支持的类型化手动/调试 seam，并不是自动注册到 DeepSeek/Host 模型工具目录的能力；在提供官方 Client Tool surface 或显式 adapter 之前，DeepSeek 不能自动发现或直接调用这些命令。破坏性操作需要精确确认令牌并写入本地审计
- 1-4 列卡片网格实时镜像房间内的每个有效项目成员：工作中 / 待你决定 / 已完成，附带运行时长与清洗后的最近消息预览
- 项目卡可直接拖拽调整顺序；点击卡片打开项目并切换到它绑定的对话，控制室卡片点击后切换到控制室绑定的对话
- 宿主会话快照的事件订阅镜像——**零轮询、零 Token**
- 玻璃拟态卡片、深色/白色/跟随系统主题、霓虹状态光效与工作中卡片的旋转彗星光点

---

## 一览

| | |
|---|------|
| 🧩 插件类型 | Cordis 插件——服务端路由 + Web 客户端，纯增量（不替换任何官方插件） |
| 🪟 工作区引擎 | 自研分栏引擎，渲染进宿主的 shell overlay 座位 |
| 💬 对话窗 | 复用宿主对话——插件只做会话选择（sessions.open） |
| 📡 状态数据 | 宿主会话运行时快照的镜像（订阅驱动） |
| 💾 状态存储 | 仅 localStorage（`dsh.worktable.controlRooms.v1`、`.trash.v1`、`.migrationBackup.v1` 及已有视图/项目键），不碰工作区文件 |
| 🎨 界面 | TypeScript + React（宿主 external）+ 原生 CSS，暗色优先 + 浅色主题 |

---

## 快速开始

1. **安装**（二选一）：

   **A · 一行命令（推荐）** —— 直接安装 GitHub Release 的安装包，无需 Git：

   ```bash
   dsh plugin --profile web add "https://github.com/Aisland-SJL/dsh-worktable/releases/latest/download/dsh-worktable.tgz"
   ```

   **B · 本地克隆（想改源码用）** —— `link:` 只接受本地绝对路径（路径不要带空格）：

   ```bash
   git clone https://github.com/Aisland-SJL/dsh-worktable.git
   dsh plugin --profile web add "link:<克隆出来的 dsh-worktable 仓库目录的绝对路径>/01_content"
   # 例：克隆到 D:\tools 后 → dsh plugin --profile web add "link:D:/tools/dsh-worktable/01_content"
   ```

   两种方式 `add` 都会把 `dsh-worktable` 注册进 profile 的 bundle 列表（写入 `~/.dsh`，可能需要授权确认）；若提示找不到 `dsh` 命令，用 `npx @deepseek-ai/dsh` 代替。
2. **重启** DSH web 进程并刷新界面
3. **打开控制室**：点击 🖥️ 控制室卡片（默认房间也是普通可删除的房间）→ 绑定一条对话（加入现有或新建）→ 得到实时卡片网格
4. **创建项目**：侧边栏 ＋ → 选布局预设、填项目文件夹

---

## 架构

一个包同时包含**宿主 Cordis 插件**与 **Web 客户端**：

- **宿主**：`/api/worktable/*` 路由——健康检查、文件系统、git、文件读写、站点托管、mkdir、工作区、原生皮肤模板；WebSocket `/api/worktable/term` 提供终端窗格（Windows 下为 PowerShell）
- **客户端**：经 slot 协议注入侧边栏与 shell overlay；分栏引擎、标签模型、拖拽与持久化均为自研
- **控制室**：读取宿主会话列表快照（运行中/待决/已完成、后台任务、子代理目录）——事件驱动镜像，模型不参与
- **窗口任务**：agent 完成后在项目文件夹写 `widget-result.json`，客户端把产物挂载进指定窗口并锁死

---

## 开发与测试

```bash
cd 01_content
npm install
npm run build     # lib/index.js + lib/client.js
node --check lib/index.js
```

- **构建必须在 01_content 内执行**——在仓库根构建会把 lib 写到错误位置，宿主仍加载旧 bundle
- 客户端 bundle 保持 `window.__ModuleLoader__.load` 握手；react 与 @deepseek-ai/* 全部 external
- 回归：全部 `04_test/control-room-*.cjs`、`04_test/control-room-acceptance.cjs`（最终 bundle + domain/browser 路径验收）、`04_test/functional-diag.cjs`（20 步严格门禁）、路径矩阵和更新检查场景。Chrome 探测使用 disposable headless profile；缺少 DSH 服务时明确记录 `SKIPPED`，不冒充通过。
- 手动视觉验收仍待用户确认：重启用户的 disposable DSH web profile 并刷新 GUI，检查控制室导航、搜索焦点、归档确认、导入/导出和每个控制室的布局。

---

## 已知限制

- **平台**：Windows 是当前完整验证平台。macOS 为实验性支持：核心文件路径代码已做跨平台适配，但尚未在 macOS 真机完成端到端验证。
- 状态在浏览器本地（localStorage）——项目、绑定与视图不跨设备同步
- 终端窗格在 Windows 上是朴素的 PowerShell 宿主（与原生终端应用无 PTY 对等）
- 自动挂载要求 agent 确实在项目文件夹写出 `widget-result.json`
- 控制室只监控**已绑定对话**的项目；未绑定的项目显示为空闲

---

## 隐私

无遥测；除宿主 API 与插件自身路由外无任何网络请求。用户状态全部留在 localStorage。可选更新检查：对 GitHub Releases API 做只读 GET（自动每天最多一次，另有手动「立即检查」），不上传任何数据，可在设置中关闭。

---

## License

MIT

## 相关项目

- [dsh-reminder](https://github.com/Aisland-SJL/dsh-reminder) — 跨窗口的任务完成与审批提醒
- [dsh-usage](https://github.com/Aisland-SJL/dsh-usage) — 常驻的余额/用量面板
