/**
 * 叙事锚定后台结算提示词规范
 */

export const SETTLEMENT_INSTRUCTIONS = `【叙事锚定系统说明】
本轮结束前，请调用 narrative_anchor_submit 工具提交本轮叙事状态与多级记忆：
1. 当前状态（current_state）：按需增量更新 time, world, location, characters, environment, items, focus（叙事备忘）。未修改字段自动保留。
2. 短期记忆（memory.stm）：本轮必须提交恰好 1 条，总结本轮核心剧情事件（不超过12字标题 title，以及客观纯粹的 summary），永远累积。
3. 长期记忆（memory.ltm_leaf / ltm_merge）：
   - 当未合并 STM 达到 7 条时，必须提取一条连贯的核心摘要提交 ltm_leaf，并附带 3-6 个正文关键词 keywords；
   - 当某深度根节点达到 5 个时，必须合并提交 ltm_merge；
4. 动态设定（memory.known_facts）：仅追加本轮新确认的长期设定（实体名 entry、说明 summary、关键词 keywords），将自动进入世界书召回池。
5. 如需查阅历史剧情或已记录的记忆，可调用 narrative_anchor_read 工具检索。本轮无任何变化时提交空对象 {}。`
