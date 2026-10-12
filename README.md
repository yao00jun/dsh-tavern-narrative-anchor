# DSH-Tavern 叙事锚定与多维记忆压缩插件 (Narrative Anchor)

[![DSH Tavern Plugin](https://img.shields.io/badge/DSH--Tavern-Plugin%20v2-blue.svg)](https://github.com/flizzywine/dsh-tavern)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Node%2018%2B%20%7C%20Windows%20%7C%20Linux%20%7C%20macOS-orange.svg)]()

专为 **DSH-Tavern**（酒馆）打造的**标准热插拔**叙事锚定与多级记忆管理插件。

100% 对齐官方 **Plugin API v2** 规范，**零核心源码修改、零侵入式补丁**。深度吸收融合社区 [Discussion #184](https://github.com/flizzywine/dsh-tavern/discussions/184) 的 **8维多维结构化上下文压缩协议**，让长篇剧情、多人社交互动、分支剧本与深层伏笔拥有清晰、稳定、自愈的长期记忆体系。

---

## 🌟 核心特性

- 🔌 **100% 官方原生热插拔**：彻底告别旧版 11 个侵入式核心补丁与版本冲突，放入 `plugins/` 目录秒级热加载，卸载干净无残留。
- 🧠 **8 维结构化记忆压缩（吸收 Discussion #184 优质方案）**：
  - 接入官方 `ctx.tavern.compactionSection` 钩子。
  - 对历史剧情进行 8 大结构化维度归纳：**剧情脉络、人物档案、关系网、世界与设定、物品与资源、伏笔与约定、当前情况、偏好分析**。
  - 包含**系统自纠**（AI八股文审查与矛盾修复）与 **4000 Token 硬约束与严格取舍权重体系**。
- 🌲 **多级记忆自适应层级树**：
  - **STM（短期记忆）**：每轮精准提炼 1 条核心事件与标题，永久累积不随轮次丢失。
  - **LTM（长期记忆树）**：未合并 STM 达到 7 条自动聚合成 Depth 1 叶节点；同级根节点达到 5 个向上递归归并为更高层节点。
  - **Focus（叙事备忘）**：跟踪长期暗线要素，支持字数智能度量与自适应截断。
- 📚 **动态世界书原生召回池**：
  - 锚点确认的长期客观情报（`known_facts`）与会话临时世界书直接注入 `ctx.tavern.worldbookEntries`。
  - 无缝参与酒馆原生关键词激活、常驻、冷却判定机制。
  - 附带跨会话世界书组合（Combos）与一键自动绑定。
- 🔄 **按轮存档与回退自愈**：
  - 使用官方 `ctx.tavern.saveTurnData` / `readTurnData` 存储状态。
  - 玩家在酒馆中执行**回退、重新生成、改写正文、创建分支分叉（Fork）**时，锚点数据自动精准跟随剧情线对齐，绝不错乱。
- 🖥️ **深层 WebUI 控制台**：
  - 侧边栏一键打开「叙事锚定」分组，包含 **锚点状态**、**会话世界书**、**锚定设置** 三大面板。
  - 基于 `ctx.tavern.handle` 与 `ctx.tavernUi.callHost` RPC 架构，响应迅速且支持暗色/亮色自适应主题。

---

## 📦 安装方式

### 方式一：DSH 原生在线命令安装（强烈推荐）

在已配置好 DSH 的终端中直接运行：

```bash
dsh plugin --profile tavern add github:yao00jun/dsh-tavern-narrative-anchor
```

> **💡 关于 `--profile tavern` 参数说明**：
> - DSH 是多环境宿主框架：`web` profile 用于通用网页对话（例如通用破限插件 `dsh-unrestricted` 会指定 `--profile web`），而 `tavern` profile 专属于 **DSH-Tavern（酒馆）**。
> - 酒馆专属插件（如世界书、记忆锚定、卡牌拓展）**必须安装在 `tavern` profile** 下。
> - 在外部终端（PowerShell / CMD / Linux bash）中执行时，**务必显式携带 `--profile tavern`**，以确保插件准确写入酒馆配置，避免被误装到通用 web 目录中导致酒馆内无法识别。
> - 若是在 DSH-Tavern 桌面客户端内置终端（设置 → 通用设置 → 打开终端）中操作，环境已默认预设为 tavern，但显式携带 `--profile tavern` 依然是最通用且不易出错的推荐写法。

---

### 方式二：Releases 离线安装包（小白双击安装）

1. 在 GitHub 本仓库的 [Releases](../../releases) 页面下载最新的 `dsh-tavern-narrative-anchor-v1.0.0.zip`。
2. 解压 zip 压缩包。
3. 双击运行其中的 **`run-install.cmd`**。
4. 安装脚本会自动检测你的 DSH-Tavern 安装路径（支持一键桌面版、DSH Desktop、Web版/命令行版同时检测并部署）并部署到 `plugins/` 目录。
5. 打开或刷新酒馆，即可直接使用！

---

### 🖥️ 桌面版与 🌐 Web版 使用对照说明

本插件完全遵照官方规范开发，**原生同时支持桌面版与 Web版**：

| 运行环境 | 宿主形态 | 推荐在线安装方式 | 离线安装与生效操作 |
|---|---|---|---|
| **DSH Tavern 桌面版**<br>(Windows 一键 EXE / 独立客户端) | Electron 窗口客户端 | 在桌面端进入 **设置 → 通用设置 → 打开 DSH 终端**，运行：<br>`dsh plugin --profile tavern add github:yao00jun/dsh-tavern-narrative-anchor` | 运行 `run-install.cmd` 自动部署；<br>桌面端窗口按 `Ctrl+R` 或重启软件生效 |
| **DSH Desktop 桌面版**<br>(官方客户端选用 tavern Profile) | DSH Desktop 宿主 | 在 DSH Desktop 设置中打开 DSH 终端运行安装命令 | 运行 `run-install.cmd` 自动部署；<br>刷新客户端或重载 Profile 生效 |
| **Web版 / 命令行版**<br>(`dsh-tavern start` / 浏览器访问) | Node.js 后台服务 + 浏览器 | 在系统命令行直接运行：<br>`dsh plugin --profile tavern add github:yao00jun/dsh-tavern-narrative-anchor` | 运行 `run-install.cmd` 自动部署；<br>浏览器按 `F5` 刷新网页即可生效 |

---

### 方式三：手动放置安装

将本仓库直接克隆或解压至酒馆插件数据目录：

```text
<DSH数据根目录>/profile-data/tavern/data/plugins/dsh-tavern-narrative-anchor/
```

目录结构示例：
```text
plugins/dsh-tavern-narrative-anchor/
├── package.json
├── cordis.patch.yml
├── index.mjs
├── client.js
└── lib/
```

刷新酒馆网页，插件即刻生效，无需重启 DSH。

---

## 🛠️ 新旧架构演进对比

| 模块 | 旧版社区魔改版 (v0.9.x) | 本插件 (v1.0 标准热插拔版) |
|---|---|---|
| **接入模式** | 侵入式修改 11 个酒馆核心文件 (`context-planner.js` 等) | **100% 官方标准热插拔**，零修改任何酒馆核心源码 |
| **版本兼容性** | 绑定特定 commit，酒馆一更新即报错崩溃 | 基于官方 **Plugin API v2**，跨版本永久向前兼容 |
| **压缩提示词** | 简易扁平摘要 | 吸收 **Discussion #184** 的 8 维结构化深度压缩与自纠协议 |
| **工具注册** | 手工 hack 后台 runner 与 `mvuSettlement` 分发 | 官方 `ctx.tavern.settlementTool` 规范注册 |
| **正文状态注入** | 侵入式修改 `plan.sections` 插入逻辑 | 官方 `ctx.tavern.turnSection` 规范插槽 |
| **世界书整合** | 拦截并修改底层世界书合并流程 | 官方 `ctx.tavern.worldbookEntries` 原生召回池 |
| **通信机制** | 自建 HTTP 服务与 28 个硬编码 fetch 路由 | 官方 `ctx.tavern.handle` / `ctx.tavernUi.callHost` RPC 桥接 |
| **存档同步** | 自行写本地 JSON 文件，回退时常常数据脱节 | 官方 `saveTurnData` / `readTurnData` 原生按轮存档与回退自愈 |

---

## 💡 使用指南

1. **进入游戏**：在酒馆中选择任意角色卡开始对话。
2. **后台自动工作**：
   - 每轮对话生成后，后台结算模型会自动调用 `narrative_anchor_submit` 工具记录本轮剧情主干、在场状态与动态设定。
   - STM 达到 7 条时，系统将智能提示模型聚合提炼长期记忆节点（LTM）。
3. **查看与调整状态**：
   - 点击右侧栏的「+」号，展开「叙事锚定」分组。
   - 打开 **「锚点状态」**：实时查看当前剧情时间、地点、在场人物、环境、STM 与 LTM 层级树。支持人工编辑纠错。
   - 打开 **「会话世界书」**：查看动态沉淀的剧情情报，支持临时条目强制注入与全局绑定。
   - 打开 **「锚定设置」**：调整 STM 阈值、注入位置与功能开关。
4. **历史压缩（Compaction）**：
   - 当上下文轮次达到酒馆压缩上限触发浓缩时，插件会自动将 Discussion #184 的 8 维协议注入压缩提示词，产出条理分明、重点突出的高质量结构化摘要。

---

## 💻 开发者说明

### 核心文件组织

```text
dsh-tavern-narrative-anchor/
├── package.json               # 声明插件入口、Cordis patch 与客户端注入
├── cordis.patch.yml           # 支持 dsh plugin add 在线安装的 patch 清单
├── index.mjs                  # 宿主侧核心逻辑（消费 ctx.tavern API v2）
├── client.js                  # 浏览器侧 UI 界面（消费 ctx.tavernUi）
├── run-install.cmd            # 离线双击安装脚本
├── install.ps1                # PowerShell 自动化环境探针与部署脚本
├── lib/
│   ├── data-store.js          # 本地持久化与快照日志辅助
│   ├── prompts/
│   │   ├── compactor-8dim.js  # Discussion #184 8维多维压缩协议
│   │   └── settlement-rules.js# 后台结算协议指导提示词
│   ├── settlement/
│   │   ├── store.js           # LTM 树型结构与 STM 累积引擎
│   │   ├── strategies.js      # 锚点工具 Schema 与记忆搜索算法 (IDF+滑窗)
│   │   └── mvu-audit.js       # 变量审计与格式化工具
│   ├── session-worldbook.js   # 动态会话世界书维护逻辑
│   ├── worldbook-combos.js    # 世界书跨会话组合管理
│   ├── official-worldbook.js  # 官方世界书探针与快照映射
│   └── family.js              # 分支/支线 (Fork) 族谱追踪
└── scripts/
    └── build-release.mjs      # 一键生成 Release zip 发布包
```

### 构建发布包

运行以下命令即可在 `dist/` 目录下打包出可供 GitHub Release 发布的 zip 文件：

```bash
node scripts/build-release.mjs
```

---

## 📄 开源许可证

本项目基于 [MIT License](LICENSE) 开源。
欢迎提出 Issue 与 Pull Request！感谢 DSH-Tavern 与社区创作者对酒馆生态的贡献！
