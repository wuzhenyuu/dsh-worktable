# dsh-worktable（工作台）

> DeepSeek Harness 侧边栏的 agent 级项目容器（应用抽屉）。纯增量插件，不替换、不禁用任何官方插件。

## 是什么

- **侧边栏「工作台」区块**：收纳用户自建项目与入驻插件项目，支持改名/图标/排序/显示隐藏、项目 × 对话绑定、项目文件夹。
- **分栏工作区引擎（自研）**：声明式布局预设（左栏/顶行/主行 + 右侧对话窗），窗格可拖拽分割、标签页模型；内置 资源管理器 / 终端 / 浏览器 / 动画 / 自定义窗口。
- **控制室**：默认自带项目（固定首位、不可删除），项目卡片网格实时监控所有项目的状态（工作中/待你决定/已完成），零轮询零 Token。
- **多控制室**：控制室配置写入 `dsh.worktable.controlRooms.v1`、`.trash.v1`、`.migrationBackup.v1`；项目只以 ID 引用，可创建 10+ 个控制室、分别绑定会话、规则筛选、独立排序/布局、归档恢复和最后一个控制室的空状态。`Ctrl+K` / `Ctrl+Shift+P` 搜索控制室、项目、对话和规则。
- **导入/安全**：导出格式为 `dsh-control-rooms-v1.json`，导入只覆盖控制室配置并重映射冲突 ID。DeepSeek 的 `control_room.*` 是类型化的客户端 localStorage fallback，不保证自动注册到 Host 模型工具目录；删除、批量移除和替换规则等破坏性操作需要确认，最近 100 条变更保留在本地审计。
- **外观与背景**：在左下角“设置”中分别配置 Web 主界面和侧边栏的主题色、背景图片、透明度、遮罩、模糊与图片位置；侧边栏可跟随主界面，也可完全独立。这组设置不控制 dsh-usage 硬件监控台。
- **自动挂载握手**：项目内 agent 完成窗口任务后写 widget-result.json，产物自动挂进对应窗口。
- **平台**：Windows 是当前完整验证平台；macOS 为实验性支持（核心文件路径代码已做跨平台适配，尚未真机端到端验证）。

## 技术底座

- Cordis 插件协议（客户端 bundle + 服务端路由 /api/worktable/*、终端 WebSocket）。
- 界面经 slot 座位协议注入侧边栏与 shell.overlay；对话窗复用宿主会话服务（sessions.open）。
- 状态监控为宿主会话运行时快照的事件订阅镜像；视图/项目/绑定状态存 localStorage。
- 客户端：TypeScript + React（host externals）+ 原生 CSS；服务端：Node。

## 安装

方式 A（推荐，无需 Git）——直接安装 GitHub Release 的安装包：

    dsh plugin --profile web add "https://github.com/Aisland-SJL/dsh-worktable/releases/latest/download/dsh-worktable.tgz"

方式 B（想改源码用）——克隆仓库后用本地路径注册（`link:` 只接受本地路径，不要带空格）：

    git clone https://github.com/Aisland-SJL/dsh-worktable.git
    dsh plugin --profile web add "link:<克隆出来的 dsh-worktable 仓库目录的绝对路径>/01_content"

两种方式 `add` 都会把 `dsh-worktable` 注册进 profile 的 bundle 列表（写入 `~/.dsh`），装完重启 dsh web、刷新界面生效。

## 从源码构建

    cd 01_content
    npm install
    npm run build   # lib/index.js + lib/client.js
    node --check lib/index.js

回归验收（从仓库根执行）：

    node 04_test/control-room-acceptance.cjs
    node 04_test/control-rooms-domain.cjs
    node 04_test/control-rooms-integration.cjs
    node 04_test/control-room-runtime.cjs
    node 04_test/control-room-rules.cjs
    node 04_test/control-room-rule-refresh.cjs
    node 04_test/control-room-search.cjs
    node 04_test/control-room-tools.cjs

`control-room-acceptance.cjs` 会执行最终 `lib/client.js` 的 ModuleLoader 握手和生产纯逻辑验收；若当前环境没有可安全启动的 disposable DSH 服务，会精确输出 `service-restart: SKIPPED`。手动 GUI 视觉验收仍需在用户确认后执行。

## 构建注意事项

- **必须在 01_content 目录下构建**：误在仓库根跑会把 lib 写到仓库根，宿主仍加载 01_content/lib 旧 bundle（「改完不生效」假象）。
- 客户端 bundle 保持 window.__ModuleLoader__.load 握手，react/@deepseek-ai/* 全部 external。

## 相关文档

- 项目规则：https://github.com/Aisland-SJL/dsh-worktable/blob/main/AGENTS.md
- 需求与协议：https://github.com/Aisland-SJL/dsh-worktable/blob/main/02_process/PRD.md
- 工作日志：https://github.com/Aisland-SJL/dsh-worktable/tree/main/02_process/worklogs

## License

MIT
