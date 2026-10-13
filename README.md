# DSH-Tavern 叙事锚定与多维记忆管理插件 v2 (Narrative Anchor v2)

[![DSH Tavern Plugin](https://img.shields.io/badge/DSH--Tavern-Plugin%20API%20v2-blue.svg)](https://github.com/flizzywine/dsh-tavern)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Dependencies: Zero](https://img.shields.io/badge/Dependencies-Zero%20(Pure%20Node)-success.svg)]()
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20Linux%20%7C%20macOS-orange.svg)]()

专为 **DSH-Tavern（酒馆）** 打造的**标准热插拔**叙事锚定与多维记忆管理插件。

100% 对齐官方 **Plugin API v2** 规范，**零核心源码修改、零侵入式补丁、零外部依赖**。
深度吸收作者最新 v2 优化架构与社区多维记忆压缩规范，给一局游戏加入自愈、自适应折叠、分支互流的长期结构化记忆。

---

## 🌟 核心架构与吸收的 v2 优化亮点

1. 🔌 **100% 官方 Plugin API v2 原生热插拔**：
   - 告别旧版侵入式核心补丁与直接篡改聊天文件的风险。
   - 宿主端只引用 Node 内置库（`node:fs/promises`, `node:path`, `node:url`），**零外部 npm 依赖、无需编译**。
   - 数据完全通过官方标准接口隔离存储（`api.readGameData` / `api.saveGameData` / `api.readTurnData` / `api.saveTurnData`）。
2. 🌲 **7/5/10 规则智能折叠记忆树（Memory Tree）**：
   - **STM（短期记忆）**：每轮结算提炼 1 条核心事实，永久累积。
   - **7 折叠**：每 7 条未归并 STM 自动提炼聚合成 1 个 Depth-1 记忆节点。
   - **5 折叠**：同深度每 5 个节点向上递归归并为上一层汇总节点。
   - **10 上限兜底**：根节点数量超过 10 个自动合并最旧节点，**严格限制上下文 Token 占用**，同时完整保留剧情因果脉络。
3. 📚 **会话世界书原生深度融合（Auto Worldbook Sync）**：
   - 结算产物（客观情报 `knownFacts` 与历忆树 `memoryRoots`）自动落成可编辑的世界书条目（标【情报】、【长期记忆】）。
   - 无缝进入 Tavern 原生召回池，参与关键词命中、10 轮冷却、常驻或强制注入。
   - **保护玩家自定义**：玩家对条目的手动设置（修改关键词、设为常驻、强制召回、停用）在自动更新时完整保留。
4. 🌿 **多分支族谱与跨支线条目共享（Family Sharing）**：
   - 监听 Tavern 原生 `fork` 事件，自动将分叉支线登记为家族。
   - 支持设置支线别名（如【主线】、【别名】），家族内成员的锚点条目自动互流，无需手动反复复制。
5. 🎛️ **动态注入位置即时切换**：
   - 支持在「写作规则之前（原版默认，作为故事素材）」与「写作规则之后（更靠近输出端）」之间自由切换。
   - 无需重启服务，即改即生效。彻底优化了旧版开关设计，采用直观下拉选项。
6. 🗜️ **4000 Token 上下文压缩守卫（Compaction Section）**：
   - 接入官方 `api.compactionSection` 钩子，为会话摘要模型注入严格保护清单：
     - 取舍优先级：用户意志 > 人物关系 > 未兑现伏笔 > 当前生效设定 > 历史事件细节。
     - 4000 Token 篇幅硬约束，杜绝 AI 八股文与过度膨胀。
7. 📜 **历史回填工具（Backfill）**：
   - 可对已有旧存档（每次最多 25 轮）执行一次性 AI 整理，自动提取短期记忆、情报与世界书，不篡改原对话。
8. 🛡️ **内建自检诊断脚本（verify.mjs）**：
   - 包含一键诊断工具，自动校验包文件 SHA-256 完整性、宿主环境 API v2 能力（`compactionSection` / `worldbookEntries` / `settlementTool`）以及 Tavern 登记状态。

---

## 📦 安装方式

### 方式一：DSH 原生在线命令安装（推荐）

在外部终端（PowerShell / CMD / Terminal）或 DSH 终端中执行：

```bash
dsh plugin --profile tavern add github:yao00jun/dsh-tavern-narrative-anchor
```

> **💡 为什么要指定 `--profile tavern`？**
> - DSH 是多 profile 宿主架构：`--profile web` 面向通用 Web 网页（如通用破限插件 `dsh-unrestricted`），而 `tavern` profile 专属于 **DSH-Tavern（酒馆）**。
> - 酒馆专属插件（记忆锚定、会话世界书、结算工具等）必须写入 `tavern` profile，因此指定 `--profile tavern` 能确保插件准确装入酒馆环境。

---

### 方式二：Releases 离线一键安装包（小白双击）

1. 在 GitHub [Releases](../../releases) 下载最新 `dsh-tavern-narrative-anchor-v2.0.0.zip`。
2. 解压缩文件。
3. 双击运行其中的 **`run-install.cmd`**（或右键运行 `install.ps1`）。
4. 安装脚本会自动扫描桌面版与 Web 版的 DSH 数据目录，部署并自动调用 Tavern Plugin Loader 完成热插拔登记，最后运行 `verify.mjs` 打印自检结果。
5. 重启 DSH Tavern，即可使用！

---

### 方式三：手动放置安装

将本仓库文件放入 Tavern 插件目录：

```text
<DSH_HOME>/profile-data/tavern/data/plugins/narrative-anchor/
```

> **如何确认 `<DSH_HOME>`？**
> - **桌面版默认**：`<Tavern安装目录>/data/harness`（例如 `D:\AI\DSH-Tavern\data\harness`）
> - **Linux / macOS**：`~/DSH-Tavern/data/harness` 或 `~/.dsh`
> - 确认标准：该目录下有 `apps/dsh-tavern` 与 `profile-data/tavern/`。

目录结构要求：
```text
plugins/narrative-anchor/
├── package.json
├── index.mjs
├── client.js
└── verify.mjs
```

复制完成后，在插件目录下运行自检：
```bash
node verify.mjs
```
看到「关键项全部通过 ✅」后，重启 DSH Tavern 即可。

---

## 🖥️ 桌面版与 Web版 环境说明

| 运行环境 | 宿主形态 | 推荐安装方式 | 生效操作 |
|---|---|---|---|
| **DSH Tavern 桌面版**<br>(Windows 一键 EXE / 独立客户端) | Electron 窗口客户端 | 运行 `run-install.cmd` 或在内置终端执行 `dsh plugin --profile tavern add ...` | 托盘图标退出并重新启动 `DSH Tavern.exe` |
| **Web版 / 命令行版**<br>(`dsh-tavern start` / 浏览器访问) | Node.js 服务 + 浏览器 | 在终端执行 `dsh plugin --profile tavern add ...` | 重启服务：`dsh-tavern restart`，网页端按 `F5` 刷新 |

---

## 🎮 使用与验证指南

1. **确认开启后台结算**：
   - 插件搭车 Tavern 官方后台结算工具。
   - 打开 Tavern「设置」页面，**请务必确认开启【后台结算】或【动作结算】**（结算未开启时模型不会调用结算工具）。
2. **打开面板**：
   - 进入任意一局游戏对话。
   - 在右侧边栏点击「**＋**」开始页 -> 找到「**叙事锚定**」分组。
   - 包含三大功能面板：
     - **设置**：配置近期 STM 注入上限（1~50 条）、注入位置（写作规则之前 / 之后）、全局书目绑定。
     - **状态**：实时查看剧情状态（时间/世界/地点/在场人物/环境/物品/备忘）、记忆折叠树、已知情报、伏笔库，支持历史回填。
     - **会话世界书**：查看自动同步的条目与手动条目，支持标签筛选（锚点、支线、人工、强制、在上下文、冷却中）、批量管理、导入导出 JSON、支线族谱管理。

---

## 🛠️ 自检与故障排除

| 现象 | 排查与解决方法 |
|---|---|
| 侧边栏「＋」中找不到「叙事锚定」分组 | ① 宿主端未重启：托盘退出并重启 Tavern；② 插件放置路径错误，必须在 `profile-data/tavern/data/plugins/narrative-anchor`；③ 运行 `node verify.mjs` 查看自检报错。 |
| 玩了几轮，状态页一直显示「尚无锚点」 | **最常见原因：酒馆后台结算未开启**。请前往 Tavern 设置中打开后台结算开关。 |
| 锚点世界书条目未被召回 | 条目默认根据正文关键词触发召回（受 Tavern 10 轮冷却规则约束）；若希望每轮持续生效，请在条目上点击「设为常驻」。 |
| 报「回填期间所选正文版本已变化」 | 回填期间玩家编辑或重新生成了该轮对话；重新点击一次回填即可（防止版本错乱的有意保护机制）。 |

---

## 📄 开源许可证

本项目基于 [MIT License](LICENSE) 开源。
