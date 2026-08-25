# 多控制室与全局搜索方案

状态：实现完成，待手动视觉验收

适用项目：`dsh-worktable`

## 1. 目标

将当前唯一的固定「控制室」升级为可创建、可删除、可复制、可自动维护的多控制室系统。每个控制室拥有独立的项目集合、项目顺序、绑定对话、规则和分栏布局；同一个项目可以同时出现在多个控制室，但项目主数据只保留一份。

已确认的产品选择：

- DeepSeek 可以直接创建和整理控制室；删除等破坏性操作需要确认。
- 一个项目可以同时属于多个控制室。
- 默认控制室可以删除。
- 第一版同时支持手动控制室、规则控制室和 DeepSeek 自主创建。
- 目标规模为 10 个以上控制室；验收至少创建 5 个控制室并分别绑定 5 条不同对话。
- 顶部搜索覆盖控制室、内部项目、绑定对话和规则。
- 浏览器刷新和重启 `dsh web` 后配置必须保留。

## 2. 当前状态与改造范围

当前控制室 ID 固定为 `wt-console`，项目卡片由全局 `getConsoleCards()` 提供，只有一个绑定对话和一套控制室主题。项目、绑定和视图保存在浏览器 `localStorage`；分栏尺寸已经按 `layoutId` 保存，但目前只服务一个控制室。

涉及文件：

| 文件 | 改造内容 |
| --- | --- |
| `01_content/src/client/index.tsx` | 控制室仓库、迁移、创建、删除、切换、搜索、规则计算与 DeepSeek 工具 |
| `01_content/src/client/split.tsx` | 按当前控制室渲染项目卡片，隔离绑定对话和分栏布局 |
| `01_content/src/client/styles.ts` | 多控制室导航、搜索结果、规则编辑器和回收站样式 |
| `01_content/src/client/locales.ts` | 中英文文案 |
| `README.md`、`README.zh.md` | 功能和数据持久化说明 |

`dsh-usage` 的余额、Token、硬件监控和主题不进入控制室数据模型，继续作为独立插件运行。

## 3. 数据模型

新增 `localStorage` 键：

```text
dsh.worktable.controlRooms.v1
dsh.worktable.controlRooms.trash.v1
dsh.worktable.controlRooms.migrationBackup.v1
```

```ts
type ControlRoom = {
  id: string
  name: string
  icon: string
  description: string
  projectIds: string[]
  projectOrder: string[]
  fixedProjectIds: string[]
  excludedProjectIds: string[]
  boundSessionId: string | null
  rules: ControlRoomRule[]
  layoutId: string
  themeMode: 'dark' | 'light' | 'system'
  cardLayout: { columns: 1 | 2 | 3 | 4; cardSize: 'compact' | 'comfortable' | 'wide' }
  filters: {
    statuses: Array<'idle' | 'busy' | 'need' | 'done'>
    showHidden: boolean
    showArchived: boolean
  }
  defaultPane: 'console' | 'conversation' | 'files' | 'terminal'
  sidebarVisible: boolean
  createdAt: number
  updatedAt: number
  lastOpenedAt: number
  deletedAt: number | null
}

type ControlRoomsState = {
  version: 1
  order: string[]
  activeId: string | null
  rooms: Record<string, ControlRoom>
}

type DeletedControlRoom = {
  room: ControlRoom
  deletedAt: number
  expiresAt: number
}
```

控制室只保存项目 ID，不复制项目。项目可以出现在多个控制室；从一个控制室移除项目不会影响其他控制室。

## 4. 默认控制室与删除

默认「总览」作为普通控制室处理，可以改名、改图标、复制、隐藏和删除。删除控制室进入本地回收站，默认保留 30 天；恢复时还原项目成员、排序、规则、绑定对话、布局和主题。

允许删除最后一个控制室。删除后显示「还没有控制室」和「新建控制室」入口，不自动生成隐含控制室。不存在的项目引用和已删除的对话在恢复后显示失效状态，并提供清理或重新绑定操作。

删除确认必须明确说明：删除的是控制室配置，不会删除项目文件、项目主数据、对话内容、Token 统计或硬件监控数据。

## 5. 自动规则

第一版支持以下条件：项目状态、名称关键词、图标、标签、工作区、是否绑定对话、子代理数量、最近活跃时间、最近完成时间、隐藏状态和归档状态。

规则支持：

- `all`：全部条件满足。
- `any`：任一条件满足。
- 排除条件。
- 手动固定项目，规则不匹配时仍显示。
- 手动排除项目，规则匹配时也不显示。

```ts
type ControlRoomRule = {
  id: string
  enabled: boolean
  mode: 'all' | 'any'
  conditions: ControlRoomCondition[]
}
```

最终项目集合：

```text
手动固定项目 + 自动规则匹配项目 - 手动排除项目
```

规则只对当前控制室生效，不会把项目从其他控制室移除。项目状态、绑定、标签、工作区、子代理或规则变化时重新计算。

## 6. DeepSeek 自主管理

建议提供以下工作台工具：

```text
control_room.list
control_room.get
control_room.create
control_room.update
control_room.copy
control_room.add_projects
control_room.remove_projects
control_room.reorder_projects
control_room.set_rule
control_room.bind_session
control_room.open
control_room.archive
control_room.restore
control_room.search
```

DeepSeek 可以直接创建、改名、改图标、添加或移除项目、排序、创建规则、复制、绑定对话、打开和归档控制室。

实现边界：当前分支提供的 `window.__dshWorktable.controlRooms` 是由浏览器 `localStorage` 支持的类型化手动/调试 seam，不是自动注册到 DeepSeek/Host 模型工具目录的 Client Tool。除非宿主另行提供官方 Client Tool surface 或显式 adapter，DeepSeek 不能自动发现或直接调用这些命令。

以下操作必须确认：删除控制室、清空回收站、一次移除 5 个以上项目、覆盖全部规则、解绑运行中的管理对话、批量修改 3 个以上控制室、从所有控制室移除项目以及删除项目主数据。每次工具操作都必须使用明确的 `controlRoomId`，不能只用名称猜测目标。

## 7. 侧边栏

建议结构：

```text
控制室
  🖥️ 总览
  🧩 插件开发
  🌡️ 硬件监控
  🎨 UI 优化
  📦 发布管理
  ＋ 新建控制室
```

每行显示图标、名称、项目数量、需要处理数量和当前选中状态。超过 8 个时显示最近使用的 6 个，其余折叠到「更多控制室」；当前控制室和有待处理状态的控制室始终可见。更多菜单包含打开、重命名、复制、项目管理、规则管理、绑定、隐藏和移入回收站。

## 8. 创建与复制

创建入口包括侧边栏「新建控制室」、顶部搜索面板、控制室管理菜单和「复制为新控制室」。创建时填写名称、图标、说明、项目、规则、绑定对话和是否立即打开。默认值为：名称「新控制室」、图标 `🖥️`、空项目、跟随系统主题、2 列卡片、控制室面板。

复制控制室时复制项目集合、排序、固定和排除、规则、主题、布局和默认面板；不复制绑定对话、未读状态和临时交互状态。复制后的绑定对话为空，避免意外共用管理对话。

## 9. 全局搜索

搜索范围：控制室名称和说明、内部项目名称、项目标签和工作区、绑定对话标题、规则名称和规则关键词。

结果按相关度、当前控制室、最近使用、待处理状态排序，并去重。支持中文、英文、数字和图标搜索；最多展示 50 项，结果过多时提示继续输入。

```text
搜索：硬件

控制室
  🌡️ 硬件监控 · 2 个项目 · 1 条规则

项目
  dsh-usage · 所属控制室：插件开发、硬件监控

对话
  内存温度检测工具推荐 · 绑定于：硬件监控

规则
  硬件项目 · 项目名称包含“温度”或“GPU”
```

`Ctrl + K` 或 `Ctrl + Shift + P` 打开搜索；上下键选择，Enter 打开，Esc 关闭。点击控制室打开并恢复其布局；点击项目打开对应控制室并高亮项目卡；点击对话切换绑定对话；点击规则打开规则管理并高亮规则。

## 10. 绑定对话与布局

一个控制室最多绑定一条管理对话，一条对话可以被多个控制室绑定。删除或解绑控制室不会删除对话；对话不存在时保留控制室并显示「对话已删除」，提供重新绑定和清除绑定。

每个控制室独立保存：分栏宽度、窗口位置、当前面板、主题模式、卡片列数、卡片尺寸和默认打开面板。布局 ID 使用 `wt-console:<controlRoomId>`。Web 背景、侧边栏背景、Web 文字颜色和硬件监控主题继续保持全局，不随控制室切换改变。

## 11. 事件刷新与性能

继续使用现有宿主会话事件和快照，不轮询模型，不增加 Token 消耗。项目创建、状态变化、绑定变化、标签变化、工作区变化、子代理变化、规则变化和控制室切换都会触发当前控制室重新计算。

当前控制室目标在 100ms 内更新；非当前控制室只维护摘要数量。超过 10 个控制室时不为每个控制室渲染完整卡片，只在打开时计算卡片详情。

## 12. 数据迁移

旧 `wt-console` 迁移为一个普通控制室：保留原绑定对话、项目卡片和布局，生成 `room-default`，并设置布局 ID 为 `wt-console:room-default`。迁移只执行一次，写入版本号；迁移前备份原始数据。失败时继续使用旧单控制室逻辑，成功后不删除项目、对话或主题数据。

## 13. 异常与并发

- 项目不存在：保留引用并显示「项目已不存在」，提供清理引用。
- 对话不存在：显示「绑定对话已删除」，提供重新绑定或清除。
- 规则损坏：只禁用损坏规则，不影响其他控制室。
- `localStorage` 写入失败：保留内存状态并提示无法保存。
- 目标规模：100 个控制室、单个控制室 1000 个项目引用、搜索结果 50 项。
- 多标签页修改：监听 `storage` 事件，使用较新的 `updatedAt`；发生覆盖时提示用户重新加载当前控制室。

## 14. 操作审计

本地保留最近 100 条控制室变更，记录操作者、时间、动作、控制室 ID 和变更摘要。操作者区分 `user` 与 `deepseek`，用于撤销误操作和排查自动整理结果。

## 15. 实施阶段

1. 数据基础与迁移：控制室仓库、版本、备份和旧 `wt-console` 迁移，预计 1～1.5 天。
2. 多控制室导航：侧边栏、创建、复制、隐藏、删除、回收站、切换和项目成员，预计 1.5～2 天。
3. 绑定和布局隔离：每个控制室独立对话和分栏布局，预计 1 天。
4. 规则控制室：规则编辑器、计算器、固定和排除、状态刷新，预计 2～3 天。
5. 全局搜索：索引、相关度排序、键盘快捷键、结果跳转，预计 1～1.5 天。
6. DeepSeek 工具：工具定义、参数校验、确认机制、审计日志，预计 2～3 天。

总估算：完整版本 8～12 个工作日；只做手动多控制室和全局搜索约 4～6 个工作日。

依赖顺序：

```text
数据模型与迁移
  ├─ 多控制室导航 ─ 绑定和布局隔离 ─ DeepSeek 工具
  ├─ 规则控制室 ─ 全局搜索
  └─ 多控制室导航 ─ 全局搜索
```

## 16. 验收标准

1. 可以创建至少 10 个控制室。
2. 可以创建 5 个控制室并分别绑定 5 条不同对话。
3. 刷新浏览器和重启 `dsh web` 后配置保持不变。
4. 一个项目可以加入至少 3 个控制室，且项目不会被复制。
5. 从一个控制室移除项目不会影响其他控制室。
6. 每个控制室独立保存项目排序和分栏布局。
7. 删除控制室不会删除项目、文件或对话。
8. 删除后可以从回收站恢复；删除最后一个后显示新建入口。
9. 搜索可以命中控制室、项目、绑定对话和规则。
10. 点击搜索结果能打开正确控制室、切换对话或定位项目卡。
11. 规则可以按状态和关键词自动加入或移除项目。
12. DeepSeek 可以直接创建和整理控制室，删除操作必须确认。
13. 切换控制室不会污染 Web、侧边栏和硬件监控主题。
14. 现有项目绑定、控制室卡片状态、拖拽排序和分栏功能无回归。

## 17. 测试计划

| 层级 | 内容 | 目标数量 |
| --- | --- | ---: |
| 单元 | 创建、更新、复制、删除、恢复 | 8 |
| 单元 | 多控制室项目归属和排序 | 5 |
| 单元 | 规则 AND / OR / 排除 / 固定 | 10 |
| 单元 | 迁移、备份和旧版本恢复 | 5 |
| 单元 | 搜索排序、去重和结果跳转 | 6 |
| 集成 | 创建控制室、绑定对话和切换 | 3 |
| 集成 | 独立布局恢复 | 3 |
| 集成 | 删除、回收站和恢复 | 4 |
| 集成 | 状态变化触发规则刷新 | 4 |
| E2E | 5 个控制室分别绑定对话 | 1 |
| E2E | 刷新和重启后恢复 | 1 |
| E2E | 搜索控制室、项目、对话和规则 | 4 |
| E2E | DeepSeek 创建与删除确认 | 3 |

## 18. 备份、导入和回滚

提供「导出控制室配置」和「导入控制室配置」，格式为 `dsh-control-rooms-v1.json`。导入只覆盖控制室配置，不覆盖项目主数据、对话、Web 背景、侧边栏背景或硬件监控主题；ID 冲突时生成新 ID。

出现严重问题时停止写入新格式，使用迁移备份恢复旧 `wt-console`，保留新格式数据，修复后再迁移。版本号控制迁移，禁止直接覆盖未知格式。

## 19. 不在本次范围

- 多用户共享、团队权限和云端同步。
- 跨设备实时同步。
- 控制室版本历史和跨控制室工作流。
- 自动删除长期不活跃项目。
- 修改项目主数据和 DeepSeek 会话存储格式。
- 修改 `dsh-usage` 的硬件采集方式。
- 按控制室分别保存硬件监控数据。

## 实现验证记录（Task 7）

- 已完成控制室仓库、迁移、导航、独立绑定/布局、规则、全局搜索和类型化客户端命令桥接。
- 持久化键为 `dsh.worktable.controlRooms.v1`、`dsh.worktable.controlRooms.trash.v1`、`dsh.worktable.controlRooms.migrationBackup.v1`；项目主数据、对话、外观和硬件监控数据不进入控制室配置。
- 已加入最终 bundle / domain acceptance probe：node 04_test/control-room-acceptance.cjs。当前环境以 disposable loopback HTTP fixture + headless Chrome 加载当前分支 final bundle，真实挂载生产 WorktableSection/bridge 并完成 138 项浏览器检查；未发现可安全启动的 disposable DSH service，因此服务重启持久化标记为 SKIPPED，不作为通过项。
- 04_test 的 Chrome 探针使用临时 headless profile；不会启动可见浏览器，也不会修改活动 DSH profile、官方插件或 dsh-usage。
- 手动视觉验收仍待用户在 disposable DSH web profile 中重启服务并刷新 GUI 后确认。
