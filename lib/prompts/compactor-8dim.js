/**
 * Discussion #184: 8-Dimensional Structured Context Compaction Prompt for DSH-Tavern
 * 
 * 专为长篇角色扮演与深度剧情设计的 8 维结构化记忆压缩协议：
 * 1. 剧情脉络 (Plot Progression & Structural Links)
 * 2. 人物档案 (Character Profiles, Evolution & States)
 * 3. 关系网 (Directed Relationships & Evolution)
 * 4. 世界与设定 (Worldbuilding Rules & Lore)
 * 5. 物品与资源 (Item States, Locations & Clues)
 * 6. 伏笔与约定 (Pending Foreshadows & Unfulfilled Promises)
 * 7. 当前情况 (Current Situation & Off-screen Dynamics)
 * 8. 偏好分析 (Player Intent & Aesthetic Guidelines)
 * + 系统自纠 (AI Cliché Review & Inconsistency Detection)
 * + 4000 Token 硬约束与严格取舍权重体系
 */

export const COMPACTION_8DIM_PROMPT = `Condense prior history into structured summary for plot continuation. Include main plot, old summaries & worldbook snapshot facts. Newer main text overrides conflicting old summaries. 禁止摘录常驻世界书和长期偏好中的内容（compacted-summary前的内容会被程序保留，不包含在压缩摘要的目标内容中）！

篇幅硬约束：输出控制在 4000 token 以内，超限即为失败
只输出摘要本身，按以下八段组织，某段无内容写「ToPopulate」：

剧情脉络：Record key events, causal chains & pending items chronologically. Preserve exact time, location, participants and outcomes. Content summary handled separately; prioritize structural links.
人物档案：每位人物一行——身份、外貌特征、性格、口吻习惯、能力、动机、秘密、当前状态（伤势/持有/所在位置/活动）、Sexualization、Erogenous、Allure、Genitalia；Take note of newly introduced characters; Monitor character changes and Offline Activity for departed characters
关系网：Directed relationships and evolution between entities—relationship type, current stage, key turning-point events, secrets, promises, Amorous, Lust | map
世界与设定：各轮世界书与正文中确立的世界观——Geography, Location, organize, Power/Technology, economic, political, Important History, Public and Secret；不要抄录，整理为关键规则
物品与资源：重要物品的持有者、所在位置、状态与来历
伏笔与约定：所有未解决线索、未兑现约定、待确认事项、用户否定过的走向；已兑现的注明结果，若篇幅不足，则压缩或删除已兑现的伏笔，仅保留精要事实
当前情况：Time, location, present characters, their states & ongoing actions, ambient mood. Concise, no redundancy. Prioritize off-screen hidden character dynamics. Live scene handled by separate system maintenance. 注意不要和剧情主线段冗余！关注暗线进展！
偏好分析：用户明确表达过的偏好、底线与对剧情的纠正；用户表述的事实永远有效
系统自纠：矛盾判断与文风批评（AI八股文审查），给出建议

参考上述字段说明，灵活记录

记录要求：
保留专名、数字、称谓与用户原话中的关键表述，但不要冗余，拒绝无意义的修辞
一次性描写不得写成永久设定，剧情尽量压缩
遇到取舍时优先保：用户意志 > 人物关系 > 未兑现伏笔 > 当前生效设定 > 历史事件细节 > 当前现场；结果 > 过程；结构关系 > 场景叙述；暗线发展 > 过期主线; 长期影响 > 短期事态
只总结已发生的内容，不续写、不猜测、不评价，只输出摘要
已有摘要也一起归纳，合并重复内容，省略琐碎和失效的细节，使摘要显著短于原文
核心要务：提炼关键信息，精炼有效的规则集，而非叙述性描写；结构化摘要，各段不要重复冗余，职责清晰`
