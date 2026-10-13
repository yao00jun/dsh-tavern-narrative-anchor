# Narrative Anchor v2 — 安装说明

> 打包日期 **2026-10-13**｜实测环境 **DSH Tavern 2.6.0**（commit `537e878f`）
> 包内文件 sha256 见文末；**请勿修改包内任何文件**。安装 = 复制一个文件夹 + 重启，不需要编译、不需要装依赖。

---

## 0. 给 AI 的直接指令（照做即可）

**任务**：把 `narrative-anchor` 文件夹原样复制到目标机器的
`<DSH_HOME>/profile-data/tavern/data/plugins/narrative-anchor/`，重启 DSH Tavern，然后跑一次自检。

**只做这三步 + 一步自检**：

1. 确定 `<DSH_HOME>`（见 §2，判断标准：该目录下有 `apps/dsh-tavern`、`profiles/tavern/package.json`、`profile-data/tavern/`）。
2. 整目录复制 `narrative-anchor/` → `<DSH_HOME>/profile-data/tavern/data/plugins/`
3. 重启 DSH Tavern（见 §4.1）。
4. 自检：`node <...>/profile-data/tavern/data/plugins/narrative-anchor/verify.mjs`

**边界（不要做）**：

- ❌ 不要改 Tavern 本体的任何文件（`apps/dsh-tavern/**`）
- ❌ 不要改 `profiles/tavern/package.json`、不要跑 `npm/pnpm install`
- ❌ 不要手写 `cordis.patch.yml`、不要手建 `.tavern-entry.mjs`（Tavern 自己会生成）
- ❌ 不要把插件放进 `.../profile-data/tavern/data/tools/`（那是"用户工具"机制，放错不会加载）
- ❌ 不要读、不要导出用户的聊天记录或存档内容

若目标机器上**已经装过原版 narrative-anchor v0.9.25**（那个是"打 11 处 Tavern 源码补丁"的 Cordis 插件，会出现在 `profiles/tavern/package.json` 的依赖里），**先停下来问用户**：两者不要混装。

---

## 1. 这是什么

- **形态**：DSH Tavern 的**用户插件**（走 Tavern 官方 Plugin API v2），**不改 Tavern 本体**、不改 profile 依赖、不写聊天文件、不写 Tavern 官方世界书文件。
- **作用**：给一局游戏加一层"叙事记忆"——每轮后台结算时把剧情状态/记忆整理成结构化锚点，下一轮请求自动注入，并把检索型内容放进 Tavern 原生世界书召回池。
- **主要功能**：
  1. **剧情状态**：时间/世界/地点/在场人物/环境/关键物品/叙事备忘（字段级增量合并）
  2. **大纲路线**：当前剧情节点、前情衔接、后续方向、活跃伏笔
  3. **多级记忆**：每轮 1 条 STM 永久累积；每 7 条自动归并成一层、同层每 5 个再往上并、根节点超 10 个由程序兜底合并（**7/5/10 规则**）
  4. **会话世界书**：结算产物自动落成可编辑的临时世界书条目（标「锚点」），进入 Tavern 原生召回池；可单独停用/常驻/强制/改关键词/删除
  5. **支线族谱**：用 Tavern 原生 fork 建支线后自动登记，可改别名、解除关联、并族、手动同步；族内成员的锚点条目以【别名】前缀互流
  6. **标签筛选**：锚点 / 支线 / 人工 / 强制注入 / 在上下文 / 已停用 / 关键词命中 + 交集
  7. **回填**：对已完成的历史轮次做一次性锚点整理
  8. **压缩配合**：给 Tavern 的压缩提示词追加"必须保留什么"的清单（含 4000 token 篇幅上限）

---

## 2. 前置条件：依赖与版本要求（装之前先确认）

### 2.1 版本要求（必须满足）

| 项 | 要求 | 本包实测环境 |
|---|---|---|
| **DSH Tavern** | 必须支持 **Plugin API v2** ⇒ **Tavern ≥ 2.5.0** | **2.6.0**，commit `537e878f` |
| **宿主 DSH** | Tavern 的 `config/dsh-compatibility.json` 声明 `adaptedDshVersion = 0.1.5-rc.2`，且 Tavern **要求内置 DSH 版本完全匹配**（启动/更新时会校验） | `0.1.5-rc.2` |
| **Node** | 不需要单独安装，用 Tavern 自带的即可（Tavern 自身要求 `engines.node >= 22.19.0`；自检脚本 `verify.mjs` 也就用这套 node 跑） | 宿主内置 Node v24.18.1 |
| 桌面运行时（仅桌面版） | 兼容声明给的建议值 `recommendedDesktopVersion = 2.0.13`。**这是 Tavern 的建议，不是本插件的要求** | DSH Desktop 2.0.13 |

> Tavern 太老（无 API v2）时：插件会被 Tavern **安全跳过**，只在日志里留一行，**不会让 Tavern 起不来**。

### 2.2 本插件的运行时依赖：**零**

- 宿主半边 `index.mjs` 只 import 三个 **Node 内置模块**：`node:fs/promises`、`node:path`、`node:url`
- 浏览器半边 `client.js` 只 `require('react')` —— 由 Tavern 宿主自己的模块加载器提供
- 自检脚本 `verify.mjs` 只用 `node:fs`、`node:crypto`、`node:path`、`node:url`
- ⇒ **不需要 `npm install` / `pnpm install`，不需要联网下载任何包，不需要改 `profiles/tavern/package.json`，也不需要往任何 `dependencies` 里加东西**（这也是本包"复制 + 重启"就能装的原因）

### 2.3 与 Tavern 自带依赖的关系：**无关、不碰**

Tavern 自带的下面这些**与本插件没有依赖关系**，本插件既不引用也不修改它们（列出来只是避免被误以为需要匹配版本）：

`dsh-pocket 2.10.6`、`dsh-better-sidebar 0.19.1`、`dsh-web-mobile 2.4.1`、`dsh-tavern-plugin` / `dsh-tavern-remote` / `dsh-dream-skin`（均为本地 link）。

### 2.4 运行前提（不是版本问题，但同样必须）

- **Tavern 的「结算」必须开着**（部分版本叫「动作结算」或后台结算）。本插件**搭车官方结算**、自己不发起结算 —— 结算不开，它就永远不会被调用，也不会写入任何锚点。
- **权限**：只需要能写 Tavern 数据目录（`<DSH_HOME>/profile-data/tavern/data/plugins/`）。

### 2.5 找到 DSH_HOME

`<DSH_HOME>` 是 Tavern 的 DSH 数据根，判断标准（三条同时满足）：

```
<DSH_HOME>/apps/dsh-tavern/.dsh-tavern-release.json   ← 存在即基本可确认
<DSH_HOME>/profiles/tavern/package.json               ← 必须存在
<DSH_HOME>/profile-data/tavern/                        ← 必须存在（插件要装到这里面）
```

- **桌面版默认**：`<Tavern 安装目录>/data/harness`
  例如 `D:\taven\DSH-Tavern\data\harness`（Windows）/ `~/DSH-Tavern/data/harness`（macOS、Linux）
- ⚠️ **不要**用 `~/.dsh`；⚠️ 一台机器上可能有多个 DSH 数据根（例如另一个 profile 的），务必按上面三条确认，装错位置不会生效。

---

## 3. 安装

最终目录结构必须长这样：

```
<DSH_HOME>/profile-data/tavern/data/plugins/
└─ narrative-anchor/
   ├─ package.json
   ├─ index.mjs
   ├─ client.js
   └─ verify.mjs      ← 自检脚本，可选
```

复制完成后，Tavern 会**自动**做两件事（不用你管）：

- 在插件目录里生成 `.tavern-entry.mjs`（加载守卫：插件出错只记日志，不会拖垮启动）
- 在 `<DSH_HOME>/profiles/tavern/cordis.patch.yml` 里加一条 `tavern-user-plugin-narrative-anchor-v2`

> 若 Tavern 正在运行，它会在约 1 秒内自动同步；若没运行，下次启动时同步。

**参考命令（Windows / PowerShell）**

```powershell
$dsh = 'D:\taven\DSH-Tavern\data\harness'      # ← 换成 §2 确认为正确的那个
$dest = Join-Path $dsh 'profile-data\tavern\data\plugins'
New-Item -ItemType Directory $dest -Force | Out-Null
Copy-Item '.\narrative-anchor' $dest -Recurse -Force
```

**参考命令（macOS / Linux）**

```bash
dsh="$HOME/DSH-Tavern/data/harness"             # ← 换成 §2 确认为正确的那个
mkdir -p "$dsh/profile-data/tavern/data/plugins"
cp -R ./narrative-anchor "$dsh/profile-data/tavern/data/plugins/"
```

---

## 4. 重启与验证

### 4.1 重启（必须）

宿主半边（`index.mjs`）**必须重启 Tavern 才会加载**：

- 桌面版：托盘图标 → 退出，然后重新双击 `DSH Tavern.exe`
- CLI 版：`dsh-tavern restart`
- 只刷新页面**不够**（客户端半边刷新即可，宿主不行）

### 4.2 自检

```bash
node <DSH_HOME>/profile-data/tavern/data/plugins/narrative-anchor/verify.mjs
```

它会校验：① 三个文件 sha256 是否与随包一致 ② 找到 Tavern 且宿主提供 API v2 / `compactionSection` / `worldbookEntries` / `settlementTool` ③ Tavern 是否已登记本插件。
（刚复制完还没启动过 Tavern 时，第 ③ 组显示 WARN 属正常。）

### 4.3 界面验证

1. 打开一局**游玩对话**
2. 右侧栏「**＋**」开始页 →「**叙事锚定**」分组 →「叙事锚定」
3. 应看到三个页签：**设置 / 状态 / 会话世界书**
4. **⚠️ 先确认 Tavern 的「结算」是开着的**（设置里的结算/后台结算开关，部分版本叫「动作结算」）——本插件**搭车官方结算**，结算不开它就永远不会被调用
5. 正常聊 1–2 轮，然后回「状态」页：应出现「编辑第 N 轮」与剧情状态；「会话世界书」页应出现标着「**锚点**」的条目（`【情报】…` / `【长期记忆】…`）

---

## 5. 卸载

删除 `<DSH_HOME>/profile-data/tavern/data/plugins/narrative-anchor` 整个文件夹 → 重启 Tavern。
Tavern 会自动把 `cordis.patch.yml` 里那条登记移除。残留只有一个 localStorage 键（面板内页签状态），无害。

---

## 6. 已知限制（请如实转告使用者）

1. **必须开结算**：插件只往 Tavern 官方结算里追加工具与说明，**自己不发起结算**；结算不开 → 不会写入任何锚点。
2. **伏笔库目前是空转的**：界面与数据结构都在，但**后台结算模型没有被引导去维护它**，所以它大概率一直是空的。（原因与完整修法已记录在开发者的知识库里，属"未接线"，不是坏了。）
3. **条目吃 Tavern 的十轮冷却**：锚点/支线条目进入原生召回池后，被注入一次就会冷却 10 轮。想让某条**每轮都在上下文里**，必须设「**设为常驻**」；「强制召回」只跳过关键词条件，**不绕过冷却**。
4. **不接管**：不替换 Tavern 的结算（不注册 `replaceSettlement`）、不碰 MVU 变量与姿势系统，两者可共存。
5. **共享书目存在插件自己目录下的 `data/global.json`**（首次保存共享书目时才创建），不会写进 Tavern 官方世界书文件。
6. **依赖宿主版本**：需要 Tavern 的 Plugin API v2（≥ 2.5.0）。更老的 Tavern 上插件会被**安全跳过**（只记一行日志），不会让 Tavern 起不来。
7. **不做的事**：不读聊天/Session 内部文件、不自动创建分支、不修改人物卡。

---

## 7. 排错

| 现象 | 原因 / 处理 |
|---|---|
| 「＋」开始页里没有「叙事锚定」分组 | ① 宿主半边没重启 → 重启 Tavern；② 复制位置错了（不能放 `data/tools/`）；③ 跑 `verify.mjs` 看第 ① 组是否 FAIL |
| 面板打不开 / 三页空白 | 刷新页面（客户端半边）；仍不行看宿主日志：`<Tavern 安装目录>/data/desktop/logs/host/dsh-<日期>.log` |
| 聊了好几轮，状态页一直「尚无锚点」 | **最可能是结算没开**。其次：本局把插件关掉了（每局可单独关插件）。再其次：该局是纯剧情卡且 Tavern 未进入结算阶段 |
| 锚点条目不会被召回 | 条目默认按关键词召回；把关键词设对，或直接设「设为常驻」（不受冷却影响、每轮注入） |
| 回填报「回填期间所选正文版本已变化」 | 回填期间该轮正文被重生/编辑过 —— 重新点一次即可（这是有意的保护） |
| 想确认装的是不是这个版本 | `verify.mjs` 第 ① 组三个 sha256 全 OK 即是 |

---

## 8. 校验值（SHA-256）

```
package.json  df661bd5cb6c1da740470c368c9317d6ffc77369ebde90587a133f297de2f9d6   250 B
index.mjs     ed3ae05baaf0b05eba12eea385fc53cbc942752598fe420b6c2e355e82c862f2   50496 B
client.js     475752a9fa728eface19de21a88f31a581d65d7e5b3c256293da1f7b6edfb672   39508 B
verify.mjs    （无固定校验值，非运行必需）
```

---

## 9. 技术备注（给懂代码的 AI / 人）

- 这是 **Tavern 用户插件**：目录放在 `profile-data/tavern/data/plugins/<folder>/`，由 Tavern 的 `domain/user-plugins.js` 自动扫描 → 生成 `.tavern-entry.mjs` 守卫 → 写入 `profiles/tavern/cordis.patch.yml` 的一条 `insert`。**不要手改该 patch 文件**（Tavern 会重写它，且只认 `tavern-user-plugin-` 前缀的条目）。
- `package.json` 的关键字段：`exports["."] = index.mjs`（宿主半边）、`exports["./client"] = client.js`（浏览器半边）、`dsh.client.platform = "web"`、`dsh.client.inject = ["dsh-tavern-plugin"]`。
- 宿主半边用的 API：`ctx.tavern`（`apiVersion 2`）——`handle` / `settlementSection` / `settlementTool` / `turnSection` / `worldbookEntries` / `compactionSection` / `readGameData`·`saveGameData` / `readTurnData`·`saveTurnData` / `getTurn` / `getTurnState` / `getHistory` / `runTask` / `onTimelineChanged`。
- 客户端半边用 `ctx.tavernUi.apiVersion 2`：`registerPanel` ×3 + `registerStartGroup` + `callHost`。
- 数据落点：按局数据走 Tavern 的 plugin-data 存储（`profile-data/tavern/data/plugin-data/<chatId 的 sha256>.json`）；插件私有共享书目走 `<插件目录>/data/global.json`。
- 自检脚本 `verify.mjs` 只读，不写任何文件。
