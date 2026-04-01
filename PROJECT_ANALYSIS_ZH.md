# Claude Code 源码仓库 — 项目分析

> 本文档是对本仓库的**结构化分析摘要**，便于快速建立全局认知。细节以 [README.md](README.md) / [README_CN.md](README_CN.md) 及 `docs/` 下专题报告为准。

---

## 1. 项目定位

| 维度 | 说明 |
|------|------|
| **名称与版本** | 与 npm 包 `@anthropic-ai/claude-code` **v2.1.88** 对应的**解包 / 研究用** TypeScript 源码（`src/`），非官方开源仓库。 |
| **发布形态** | 官方发行物主要是单文件 `cli.js`（约 12MB）；本仓保留的是便于阅读的未打包源码。 |
| **用途边界** | 技术学习、架构研究与安全/隐私分析。**商业使用被明确禁止**；版权归 Anthropic，详见各 README 免责声明。 |

---

## 2. 技术栈与运行要求

| 类别 | 内容 |
|------|------|
| **语言** | TypeScript / TSX（终端 UI 大量使用 React + Ink）。 |
| **目标运行时** | 发布包面向 **Node.js ≥ 18**；完整复现 Anthropic 内部构建依赖 **Bun**（`feature()`、`MACRO`、`bun:bundle` 等编译期能力）。 |
| **本仓构建** | `package.json` 提供 `prepare-src`、`build`（esbuild）、`check`（tsc）、`start`；见 [QUICKSTART.md](QUICKSTART.md)。 |
| **规模（README 统计）** | 约 **1,884** 个 `.ts/.tsx` 文件、约 **51 万+** 行代码；单文件体量最大为 `query.ts`（约 785KB）。 |

---

## 3. 仓库顶层结构（速览）

```
├── src/              # 主源码：CLI、REPL、查询循环、工具、服务、状态、Bridge、MCP 等
├── tools/            # 部分工具实现或占位（与 src/tools 配合理解）
├── scripts/          # prepare-src、esbuild 等构建脚本
├── stubs/            # 为 esbuild 等准备的宏 / Bun 相关桩
├── vendor/           # 原生相关源码桩（音频、图像、URL 等）
├── docs/             # 深度专题：遥测、代号、卧底模式、远程控制、路线图（多语言）
├── types/            # 部分类型/连接器相关
├── utils/            # 部分与 npm 包边界相关的工具（如 UDS、主题）
├── README.md         # 英文主文档（架构、工具表、数据流极全）
├── README_CN.md      # 中文主文档
├── QUICKSTART.md     # 运行预构建 CLI / 尽力从源码构建
└── package.json      # 私有包名 @anthropic-ai/claude-code-source，dev: esbuild + TypeScript
```

---

## 4. 核心架构（三层认知）

### 4.1 入口层

- **`entrypoints/cli.tsx`**：命令行入口（版本、帮助、子命令等）。
- **`main.tsx`**：交互式 REPL 引导（体量很大）。
- **`QueryEngine.ts`**：面向 SDK / 无头场景的查询生命周期引擎。

### 4.2 查询引擎与主循环

- **`query.ts`**：Agent 主循环（调用 Claude API、处理 `tool_use`、拼接消息、与压缩/权限等协作）。
- 抽象模式：**用户消息 → 系统提示拼装 → 流式 API → 工具执行 → 写回 `tool_result` → 直至非工具结束**。

### 4.3 横切能力

- **工具系统**：`Tool.ts`、`tools.ts`、`src/tools/*`（读/写文件、Bash、Glob/Grep、子代理、MCP、Skill、任务板等）。
- **服务层**：`src/services/*`（API 客户端、压缩、MCP、遥测/GrowthBook、插件、设置同步等）。
- **状态**：`src/state/*`（权限上下文、文件历史、模型与模式等）。
- **Bridge**：`src/bridge/*`（与 Claude Desktop / 远程会话、JWT、会话进程等）。
- **任务抽象**：`src/tasks/*`（本地 Shell、本地/远程 Agent、进程内队友、后台 Dream 等）。

更完整的 ASCII 架构图与数据流见 [README_CN.md](README_CN.md) 或 [README.md](README.md)。

---

## 5. 值得单独阅读的子系统

| 子系统 | 路径线索 | 要点 |
|--------|----------|------|
| **权限** | `src/utils/permissions/`、`hooks/useCanUseTool`、各 Tool 的 `checkPermissions` | 规则引擎 + Hook + 交互确认。 |
| **上下文压缩** | `src/services/compact/` | autoCompact；部分策略依赖未发布的 feature 模块。 |
| **MCP** | `src/services/mcp/`、`MCPTool`、MCP 入口 | 多传输方式、OAuth、工具动态注册。 |
| **多代理 / Swarm** | `src/utils/swarm/`、`AgentTool`、任务/团队工具 | 分叉、远程、进程内队友等模式。 |
| **遥测与远程配置** | `src/services/analytics/`、`src/utils/telemetry/` | 与 `docs/zh/01-遥测与隐私分析.md`、`04-远程控制与紧急开关.md` 对照阅读。 |

---

## 6. 源码完整性限制（研究时必须知道）

1. **约 108 个模块缺失**：仅在内部构建中通过 `feature('…')` 为真时打入包；npm 发行版在 **DCE（死代码消除）** 后**不包含**这些文件（如 daemon、部分 compact、KAIROS 相关命令与工具等）。
2. **本仓无法 1:1 复现 Anthropic 的 Bun 构建**；用 esbuild 的「尽力构建」需桩与迭代修补，见 [QUICKSTART.md](QUICKSTART.md)。
3. **`USER_TYPE === 'ant'`** 等分支表示内部员工/内部构建差异，与外部用户行为不完全一致。

---

## 7. 文档索引（深入阅读）

| 需求 | 建议阅读 |
|------|----------|
| 中文总览 + 架构图 | [README_CN.md](README_CN.md) |
| 英文最全技术索引 | [README.md](README.md) |
| 遥测、隐私、内部代号、卧底模式、远程开关、路线图 | `docs/zh/*.md` 与 `docs/en/*.md` |
| 本地跑 CLI / 构建踩坑 | [QUICKSTART.md](QUICKSTART.md) |

---

## 8. 小结

本仓库是 **Claude Code 2.1.88 的解包研究用源码树**：能系统学习**终端 Agent 产品**如何把「模型 + 工具循环」做成可发布的 CLI（权限、持久化、MCP、多代理、Bridge、压缩与遥测等）。同时必须注意 **法律/使用范围**、**与官方构建的差异**，以及 **大量 feature-gate 代码在公开包中不存在** 带来的分析上限。

---

*文档生成说明：基于仓库内 README、QUICKSTART、package.json 与目录结构整理；若与上游 npm 包版本不一致，以包内版本号为准。*
