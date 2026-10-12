/**
 * Narrative Anchor System - Client (浏览器 WebUI 侧入口)
 *
 * 使用 DSH 客户端模块系统的 factory 格式（与 dsh-pocket-console 一致），
 * 无需构建步骤即可安装。
 *
 * 注册两个侧边栏 tab：
 *   - 叙事锚定设置：开关、STM上限、注入位置、重置数据
 *   - 叙事锚定状态：展示大纲路线、当前状态、多级记忆
 *
 * 与后端通信：fetch("/api/narrative-anchor/<method>", POST JSON)
 */
window.__ModuleLoader__.load({
  id: "dsh-tavern-narrative-anchor",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    const React = require('react')
    const h = React.createElement
    let globalTavernUi = null

    // LLM 提交的字段可能是嵌套对象（如 current_state.environment = {环境: …}），
    // 直接当 React 子节点渲染会抛 Minified React error #31 —— 统一文本化兜底
    function asText(value) {
      if (value === null || value === undefined || value === false) return ''
      if (typeof value === 'string') return value
      if (typeof value === 'object') {
        try { return JSON.stringify(value) } catch { return String(value) }
      }
      return String(value)
    }
    const ReactDOM = require('react-dom')

    // [v0.9.5] 会话临时世界书导出：把临时条目转为 SillyTavern 世界书 JSON
    // （{ entries: { <uid>: {...} } } 字典格式 —— DSHT identifyWorldbook 识别为
    //   sillytavern-worldbook，可直接导入独立世界书库 / 原版 ST）。返回导出条数，0 = 无条目。
    function exportTempWorldbook(book, sessionId) {
      const list = Array.isArray(book?.entries) ? book.entries : []
      if (list.length === 0) return 0
      const out = {
        name: '会话临时世界书',
        entries: {}
      }
      list.forEach((e, i) => {
        const keys = Array.isArray(e.keys) ? e.keys.filter(Boolean) : []
        const secondary = Array.isArray(e.keysecondary) ? e.keysecondary.filter(Boolean) : []
        out.entries[String(i)] = {
          uid: i,
          key: keys,
          keysecondary: secondary,
          comment: String(e.title || ('条目 ' + i)),
          content: String(e.content || ''),
          disable: e.enabled === false,
          constant: false,
          selective: secondary.length > 0,
          selectiveLogic: 0,
          addMemo: true,
          order: 100,
          position: 0,
          excludeRecursion: false,
          preventRecursion: false,
          delayUntilRecursion: 0,
          probability: 100,
          useProbability: true,
          depth: 4,
          group: '',
          displayIndex: i
        }
      })
      const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = '临时世界书-' + String(sessionId || 'session').slice(0, 8) + '-' + new Date().toISOString().slice(0, 10) + '.json'
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      return list.length
    }

    // [v0.9.5] 通用编辑弹层：遮罩 + 居中卡片；ESC / 点击遮罩关闭，点卡片不冒泡。
    // 相比内联表单：不挤占页面流、编辑时视线聚焦、随时可放弃。
    function EditModal({ title, onClose, footer, children }) {
      React.useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose() }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [onClose])
      return ReactDOM.createPortal(
        h('div', {
          onMouseDown: onClose,
          style: {
            position: 'fixed', inset: 0, zIndex: 2147483000,
            background: 'rgba(15,18,24,.5)', backdropFilter: 'blur(2px)',
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
            padding: '8vh 16px 16px', overflowY: 'auto'
          }
        },
          h('div', {
            onMouseDown: (e) => e.stopPropagation(),
            style: {
              width: 'min(560px, 100%)', background: 'var(--na-card, #fff)',
              border: '1px solid var(--na-border, #e2e5ea)', borderRadius: 10,
              boxShadow: '0 12px 40px rgba(0,0,0,.35)', padding: '14px 16px'
            }
          },
            h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 } },
              h('h3', { style: { margin: 0, fontSize: 14 } }, title),
              h('button', { className: 'dsh-local-btn', title: '关闭（ESC）', onClick: onClose }, '✕')
            ),
            children,
            footer ? h('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 } }, footer) : null
          )
        ),
        document.body
      )
    }

    exports.apply = function(ctx) {

  // ========== 页面主题样式（na-page 作用域，避免影响 DSHT 官方面板）==========
  if (!document.getElementById('na-page-style')) {
    const naStyle = document.createElement('style')
    naStyle.id = 'na-page-style'
    naStyle.textContent = `.na-page {
  --na-card:#ffffff; --na-card-soft:#f6f7f9; --na-card-hover:#f0f2f5;
  --na-border:#e2e5ea; --na-border-hover:#c9ced6;
  --na-text:#1d2129; --na-dim:#68707c; --na-heading:#10141a;
  --na-accent:#3b6fd4; --na-accent-soft:rgba(59,111,212,.1);
  --na-green:#188a52; --na-red:#d23f47; --na-amber:#a96a0e; --na-blue:#4a6dc6; --na-purple:#8a4ad6; --na-pink:#c2185b; --na-cyan:#00879b;
  --na-btn:#eef0f3; --na-btn-border:#d8dce1; --na-btn-hover:#e2e6ec;
  --na-input-bg:#f2f3f5; --na-hover:rgba(0,0,0,.04);
  --na-warn-bg:#fff7e6; --na-warn-border:rgba(169,106,14,.35);
  font-size:13px; color:var(--na-text);
}
@media (prefers-color-scheme: dark) {
  .na-page {
    --na-card:#1b1e25; --na-card-soft:#161a21; --na-card-hover:#20242d;
    --na-border:#2b303c; --na-border-hover:#3a4152;
    --na-text:#dde3ec; --na-dim:#8a93a5; --na-heading:#ffffff;
    --na-accent:#5b8def; --na-accent-soft:rgba(91,141,239,.14);
    --na-green:#4ec08a; --na-red:#e0595f; --na-amber:#e0a94a; --na-blue:#9fb4e8; --na-purple:#b79aeb; --na-pink:#f48fb1; --na-cyan:#67c6dc;
    --na-btn:#262b36; --na-btn-border:#3a4152; --na-btn-hover:#2f3644;
    --na-input-bg:#14161b; --na-hover:rgba(255,255,255,.035);
    --na-warn-bg:rgba(224,169,74,.1); --na-warn-border:rgba(224,169,74,.32);
  }
}
.na-page * { box-sizing:border-box; }
.na-page h2 { font-size:16px; margin:0 0 10px; color:var(--na-heading); letter-spacing:.02em; display:flex; align-items:center; gap:8px; font-weight:600; }
.na-page h2::before { content:''; width:4px; height:16px; border-radius:2px; background:linear-gradient(180deg,var(--na-accent),var(--na-blue)); flex:none; }
.na-page h3 { font-size:12px; margin:0 0 10px; color:var(--na-dim); letter-spacing:.1em; font-weight:600; border-left:3px solid var(--na-accent); padding-left:8px; text-transform:uppercase; }
.na-page .dsh-local-section { background:var(--na-card); border:1px solid var(--na-border); border-radius:10px; padding:12px 12px 14px; margin-bottom:10px; transition:border-color .15s; }
.na-page .dsh-local-section:hover { border-color:var(--na-border-hover); }
.na-page label { display:flex; align-items:flex-start; gap:9px; padding:6px 7px; border-radius:7px; cursor:pointer; color:var(--na-text); font-size:12.5px; line-height:1.5; }
.na-page label:hover { background:var(--na-hover); }
.na-page label > span:first-child { flex:1; }
.na-page label input[type=checkbox] { margin-top:2px; width:14px; height:14px; accent-color:var(--na-accent); cursor:pointer; flex:none; }
.na-page input[type=checkbox] { accent-color:var(--na-accent); cursor:pointer; }
.na-page .dsh-local-btn { background:var(--na-btn); color:var(--na-text); border:1px solid var(--na-btn-border); border-radius:7px; padding:4px 11px; font-size:12px; cursor:pointer; transition:all .15s; line-height:1.5; }
.na-page .dsh-local-btn:hover { background:var(--na-btn-hover); border-color:var(--na-accent); color:var(--na-heading); }
.na-page .dsh-local-btn[disabled] { opacity:.45; cursor:not-allowed; }
.na-page .dsh-local-btn.na-tab-active { background:var(--na-accent); border-color:var(--na-accent); color:#fff; font-weight:600; }
.na-page .dsh-tavern-btn { background:var(--na-btn); color:var(--na-text); border:1px solid var(--na-btn-border); border-radius:7px; padding:4px 11px; font-size:12px; cursor:pointer; transition:all .15s; }
.na-page .dsh-tavern-btn:hover { background:var(--na-btn-hover); border-color:var(--na-accent); color:var(--na-heading); }
.na-page .dsh-tavern-btn-danger { background:rgba(210,63,71,.08) !important; border-color:rgba(210,63,71,.35) !important; color:var(--na-red) !important; }
.na-page .dsh-tavern-btn-danger:hover { background:rgba(210,63,71,.14) !important; }
@media (prefers-color-scheme: dark) {
  .na-page .dsh-tavern-btn-danger { background:rgba(224,89,95,.15) !important; border-color:rgba(224,89,95,.4) !important; color:#f0b3b6 !important; }
  .na-page .dsh-tavern-btn-danger:hover { background:rgba(224,89,95,.25) !important; }
}
.na-page .dsh-local-input { background:var(--na-input-bg); border:1px solid var(--na-border); border-radius:7px; color:var(--na-text); padding:6px 9px; font-size:12.5px; }
.na-page .dsh-local-input:focus { outline:none; border-color:var(--na-accent); box-shadow:0 0 0 2px var(--na-accent-soft); }
.na-page textarea.dsh-local-input { font-family:inherit; line-height:1.5; }
.na-page select.dsh-local-input { min-height:30px; }
.na-page .dsh-local-help { color:var(--na-dim); font-size:12px; line-height:1.65; margin:4px 0; }
.na-page .dsh-local-warning { color:var(--na-red); background:rgba(210,63,71,.08); border:1px solid rgba(210,63,71,.3); border-radius:7px; padding:7px 10px; font-size:12px; line-height:1.5; }
@media (prefers-color-scheme: dark) {
  .na-page .dsh-local-warning { background:rgba(224,89,95,.1); border-color:rgba(224,89,95,.3); color:#f0b3b6; }
}
.na-page .dsh-tavern-settings-desc { display:block; color:var(--na-dim); font-size:11.5px; margin-top:2px; letter-spacing:0; text-transform:none; }
.na-page .dsh-local-entry { background:var(--na-card-soft); border:1px solid var(--na-border) !important; border-radius:8px; transition:border-color .15s, background .15s; }
.na-page .dsh-local-entry:hover { border-color:var(--na-accent) !important; background:var(--na-card-hover); }
.na-page .dsh-tavern-stats-grid, .na-page .dsh-tavern-state-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(96px,1fr)); gap:8px; }
.na-page .dsh-tavern-stats-grid > div, .na-page .dsh-tavern-state-grid > div { background:var(--na-card-soft); border:1px solid var(--na-border); border-radius:8px; padding:9px 10px; text-align:center; }
.na-page .dsh-tavern-stats-grid b { display:block; font-size:20px; color:var(--na-heading); line-height:1.3; }
.na-page .dsh-tavern-stats-grid span { font-size:11px; color:var(--na-dim); }
.na-page .dsh-tavern-state-grid > div { text-align:left; font-size:12.5px; color:var(--na-text); line-height:1.5; }
.na-page .dsh-tavern-state-grid b { color:var(--na-blue); font-size:12px; }
.na-page ol, .na-page ul { margin:4px 0; padding-left:20px; }
.na-page li { margin:5px 0; line-height:1.55; font-size:12.5px; color:var(--na-text); }
.na-page .dsh-tavern-status-head { display:flex; align-items:center; gap:8px; margin-bottom:8px; }
.na-page .dsh-tavern-status-head strong { font-size:15px; color:var(--na-heading); }
.na-badge { display:inline-flex; align-items:center; padding:1px 8px; border-radius:20px; font-size:10.5px; line-height:1.7; font-weight:500; letter-spacing:.02em; margin-right:4px; white-space:nowrap; }
.na-badge.na-b-in { background:rgba(24,138,82,.12); color:var(--na-green); }
.na-badge.na-b-out { background:rgba(104,112,124,.12); color:var(--na-dim); }
.na-badge.na-b-force { background:rgba(169,106,14,.14); color:var(--na-amber); }
.na-badge.na-b-const { background:rgba(74,109,198,.12); color:var(--na-blue); }
.na-badge.na-b-constant { background:rgba(138,74,214,.14); color:var(--na-purple); }
.na-badge.na-b-off { background:rgba(210,63,71,.12); color:var(--na-red); }
.na-badge.na-b-ok { background:rgba(24,138,82,.12); color:var(--na-green); }
.na-badge.na-b-ext { background:rgba(120,80,190,.14); color:#9b6de3; }
.na-badge.na-b-temp { background:rgba(194,24,91,.13); color:var(--na-pink); }
.na-badge.na-b-ctx { background:rgba(0,135,155,.13); color:var(--na-cyan); }
.na-badge.na-b-bound { background:rgba(234,88,12,.13); color:#ea580c; }
.na-badge.na-b-warn { background:rgba(169,106,14,.14); color:var(--na-amber); }
.na-badge.na-b-pred { background:rgba(130,160,40,.14); color:#6f8f1f; }
@media (prefers-color-scheme: dark) {
  .na-badge.na-b-in, .na-badge.na-b-ok { background:rgba(78,192,138,.15); color:var(--na-green); }
  .na-badge.na-b-temp { background:rgba(244,143,177,.15); color:var(--na-pink); }
  .na-badge.na-b-ctx { background:rgba(103,198,220,.16); color:var(--na-cyan); }
  .na-badge.na-b-out { background:rgba(138,147,165,.13); color:var(--na-dim); }
  .na-badge.na-b-ext { background:rgba(156,112,230,.16); color:#ad82e8; }
  .na-badge.na-b-force, .na-badge.na-b-warn { background:rgba(224,169,74,.18); color:var(--na-amber); }
  .na-badge.na-b-const { background:rgba(159,180,232,.15); color:var(--na-blue); }
  .na-badge.na-b-bound { background:rgba(255,138,76,.16); color:#fb923c; }
  .na-badge.na-b-constant { background:rgba(183,154,235,.16); color:var(--na-purple); }
  .na-badge.na-b-off { background:rgba(224,89,95,.15); color:var(--na-red); }
  .na-badge.na-b-pred { background:rgba(170,200,70,.16); color:#b9d64c; }
}
.na-inject-bar { display:flex; align-items:center; gap:6px; background:var(--na-warn-bg); border:1px solid var(--na-warn-border); color:var(--na-amber); border-radius:8px; padding:6px 10px; font-size:12px; margin-bottom:10px; }
.na-page .dsh-tavern-status-body { padding:0 2px; }
/* v0.9.20: DSHT 全局 user-select:none 会继承到输入框（Chromium/Electron 下导致 input 文本无法选中、光标难以定位），页面内一律放开 */
.na-page input, .na-page textarea { user-select: text; -webkit-user-select: text; cursor: text; }
.na-page select { user-select: none; -webkit-user-select: none; }

`
    document.head.appendChild(naStyle)
  }

  // ========== 后端 API 调用 ==========
  async function api(method, payload = {}) {
    const res = await fetch('/api/narrative-anchor/' + method, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    return res.json()
  }

  // ========== 设置页面组件 ==========
  function NarrativeAnchorSettingsTab(props) {
    const sessionId = props.scope?.sessionId || props.sessionId
    const [loaded, setLoaded] = React.useState(false)
    const [busy, setBusy] = React.useState(false)
    const [error, setError] = React.useState('')
    const [notice, setNotice] = React.useState('')
    const [enabled, setEnabled] = React.useState(true)
    const [maxSTMLength, setMaxSTMLength] = React.useState(7)
    const [injectPosition, setInjectPosition] = React.useState('before-guide')
    const [projectionReplace, setProjectionReplace] = React.useState(false)
    const [skipAllPresentLtm, setSkipAllPresentLtm] = React.useState(true)
    const [stats, setStats] = React.useState({ stm_count: 0, stm_unmerged: 0, ltm_root_count: 0, ltm_total_nodes: 0, known_facts_count: 0, foreshadow_count: 0, turn_count: 0 })
    const [paths, setPaths] = React.useState({})
    const [pathsError, setPathsError] = React.useState('')
    const pathsLoadedRef = React.useRef(false)
    const busyRef = React.useRef(false)

    async function load() {
      setError('')
      try {
        const result = await api('getConfig', { sessionId })
        if (result.ok) {
          setEnabled(result.settings.enabled)
          setMaxSTMLength(result.settings.maxSTMLength)
          setInjectPosition(result.settings.injectPosition)
          setProjectionReplace(!!result.settings.projectionReplace)
          setSkipAllPresentLtm(result.settings.skipAllPresentLtm !== false)
          setStats(result.stats)
          setLoaded(true)
        } else {
          setError(result.error || '加载失败')
        }
      } catch (err) { setError(String(err.message || err)) }
    }
    // 路径信息：折叠框首次展开时才拉取一次（不进 8 秒轮询）
    async function loadPaths() {
      if (pathsLoadedRef.current) return
      pathsLoadedRef.current = true
      try {
        const result = await api('paths', {})
        if (result.ok) { setPaths(result.paths || {}); setPathsError('') }
        else { setPathsError(result.error || '未知错误'); pathsLoadedRef.current = false }
      } catch (err) { setPathsError(String(err.message || err)); pathsLoadedRef.current = false }
    }

    React.useEffect(() => {
      void load()
      // 自动刷新（v0.6.8）：8 秒轮询 + 页面切回可见时立即刷新；保存期间暂停轮询避免覆盖
      const timer = setInterval(() => { if (!busyRef.current) void load() }, 8000)
      const onVis = () => { if (!document.hidden && !busyRef.current) void load() }
      document.addEventListener('visibilitychange', onVis)
      return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVis) }
    }, [])

    async function save(patch) {
      if (busy || !loaded) return
      setBusy(true); busyRef.current = true; setError(''); setNotice('')
      try {
        const result = await api('setConfig', { sessionId, ...patch })
        if (result.ok) {
          setNotice(result.note || '已保存')
          await load()
        } else {
          setError(result.error || '保存失败')
        }
      } catch (err) { setError(String(err.message || err)) }
      finally { setBusy(false); busyRef.current = false }
    }

    return h('aside', { className: 'dsh-tavern-status dsh-local-settings na-page', 'aria-label': '叙事锚定设置' },
      h('div', { className: 'dsh-tavern-status-head' }, h('strong', null, '叙事锚定设置')),
      h('div', { className: 'dsh-tavern-status-body' },
        h('p', { className: 'dsh-local-intro' }, '仅影响本局，修改后自动保存。后台结算从下一轮生效。'),

        // 开关
        h('section', { className: 'dsh-local-section' },
          h('h3', null, '总开关'),
          h('label', { className: 'dsh-tavern-background-task' },
            h('span', null, '启用叙事锚定后台结算',
              h('span', { className: 'dsh-tavern-settings-desc' }, '关闭后不注入 system prompt 和工具，已有数据保留。')),
            h('input', { type: 'checkbox', role: 'switch', 'aria-label': '启用叙事锚定', checked: enabled, disabled: !loaded || busy, onChange: e => save({ enabled: e.target.checked }) })
          )
        ),

        // 参数设置
        h('section', { className: 'dsh-local-section' },
          h('h3', null, '参数设置'),
          h('label', null, 'STM 短期记忆上限（暂未生效）',
            h('input', { type: 'number', min: 1, max: 50, value: maxSTMLength, disabled: true, title: '阈值写死为 7，待修复后开放编辑' }),
            h('span', { className: 'dsh-tavern-settings-desc' }, '达到后整体压缩为 LTM（当前写死 7）')
          ),
          h('label', null, 'foreground 注入位置',
            h('select', { value: injectPosition, disabled: !loaded || busy, onChange: e => save({ injectPosition: e.target.value }) },
              h('option', { value: 'before-rules' }, '写作规则之前'),
              h('option', { value: 'before-posture' }, '姿势之前'),
              h('option', { value: 'after-posture' }, '姿势之后'),
              h('option', { value: 'before-guide' }, '引导之前'),
              h('option', { value: 'after-guide' }, '引导之后'),
              h('option', { value: 'end' }, '末尾')
            )
          ),
          h('label', { className: 'dsh-tavern-background-task' },
            h('span', null, '投影替换',
              h('span', { className: 'dsh-tavern-settings-desc' }, '开启后历史正文用状态+STM投影替换（仅当正文token > STM的3倍时），标记为【Summary】')),
            h('input', { type: 'checkbox', role: 'switch', 'aria-label': '投影替换', checked: projectionReplace, disabled: !loaded || busy, onChange: e => save({ projectionReplace: e.target.checked }) })
          ),
          h('label', { className: 'dsh-tavern-background-task' },
            h('span', null, 'LTM 全在场时跳过记忆快照',
              h('span', { className: 'dsh-tavern-settings-desc' }, '所有 LTM 根节点都已在上下文中时，本轮快照不含 LTM 行（STM 补注不受影响）')),
            h('input', { type: 'checkbox', role: 'switch', 'aria-label': 'LTM 全在场时跳过记忆快照', checked: skipAllPresentLtm, disabled: !loaded || busy, onChange: e => save({ skipAllPresentLtm: e.target.checked }) })
          )
        ),

        // 数据统计
        h('section', { className: 'dsh-local-section' },
          h('h3', null, '数据统计'),
          h('div', { className: 'dsh-tavern-stats-grid' },
            h('div', null, h('b', null, stats.stm_count), h('span', null, 'STM总数')),
            h('div', null, h('b', null, stats.stm_unmerged), h('span', null, 'STM未合并')),
            h('div', null, h('b', null, stats.ltm_root_count), h('span', null, 'LTM根节点')),
            h('div', null, h('b', null, stats.ltm_total_nodes), h('span', null, 'LTM总结点')),
            h('div', null, h('b', null, stats.known_facts_count), h('span', null, '已知情报')),
            // [2026-09-29 暂停] 伏笔库暂时不单独维护
            // h('div', null, h('b', null, stats.foreshadow_count), h('span', null, '伏笔')),
            h('div', null, h('b', null, stats.turn_count), h('span', null, '轮次'))
          )
        ),

        // 路径信息（v0.9.x）：全部由后端运行时推导，非写死
        h('section', { className: 'dsh-local-section' },
          h('details', { className: 'na-paths', onToggle: e => { if (e.target.open) void loadPaths() } },
            h('summary', { style: { cursor: 'pointer', fontWeight: 'bold' } }, '路径信息',
              h('span', { className: 'dsh-tavern-settings-desc', style: { marginLeft: 8 } }, '关键配置与工具的本地绝对路径（运行时读取）')),
            pathsError
              ? h('p', { className: 'dsh-tavern-settings-desc' }, '读取失败：' + pathsError)
              : Object.entries(paths).map(([key, item]) => (item && item.path && item.present !== false)
                ? h('div', { key, style: { margin: '6px 0' } },
                    h('div', { className: 'dsh-tavern-settings-desc' }, item.desc || key),
                    h('div', { style: { fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all', color: 'var(--na-info, #7aa2f7)' } }, item.path))
                : null)
          )
        ),

        // 重置
        h('section', { className: 'dsh-local-section' },
          h('h3', null, '数据管理'),
          h('button', { className: 'dsh-tavern-btn dsh-tavern-btn-danger', disabled: !loaded || busy, onClick: () => { if (confirm('确定要清空当前对话的所有叙事锚定数据吗？此操作不可撤销。')) save({ reset: true }) } }, '重置所有数据')
        ),

        error ? h('p', { className: 'dsh-local-warning' }, error) : null,
        notice ? h('p', { className: 'dsh-local-help' }, notice) : null
      )
    )
  }

  // ========== LTM 树递归渲染辅助（v0.8.0） ==========
  function renderLtmTreeNode(node, tree) {
    if (!node) return null
    const depthMark = '[L' + (node.depth || 1) + ']'
    const childNodes = Array.isArray(node.children)
      ? node.children.map(cid => tree && tree.nodes ? tree.nodes[cid] : null).filter(Boolean)
      : []
    return h('li', { key: node.id },
      h('div', null, h('b', null, depthMark + ' '), asText(node.summary) || '(无摘要)'),
      node.turn ? h('div', { className: 'dsh-tavern-settings-desc' }, '轮次 ' + node.turn) : null,
      childNodes.length ? h('ul', null, childNodes.map(child => renderLtmTreeNode(child, tree))) : null
    )
  }

  // ========== 状态页面组件 ==========
  function NarrativeAnchorStatusTab(props) {
    const sessionId = props.scope?.sessionId || props.sessionId
    const [loaded, setLoaded] = React.useState(false)
    const [error, setError] = React.useState('')
    const [anchor, setAnchor] = React.useState(null)
    const [display, setDisplay] = React.useState('')
    // v0.9.0：人工编辑状态
    const [editing, setEditing] = React.useState(null) // 编辑路径，如 'current_state.time' / 'stm.0' / 'ltm.2' / 'kf.0'
    const [editDraft, setEditDraft] = React.useState(null) // 编辑草稿对象
    const [expandedLtm, setExpandedLtm] = React.useState(new Set()) // 展开的 LTM 节点 ID
    const [expandedMerged, setExpandedMerged] = React.useState(new Set()) // 展开的已合并 STM 分组（按 LTM 节点 ID）
    const [expandedMergedAll, setExpandedMergedAll] = React.useState(false) // 已合并 STM 大折叠块
    const [saving, setSaving] = React.useState(false)
    const [tip, setTip] = React.useState('')

    function showTip(msg) {
      setTip(msg)
      setTimeout(() => setTip(''), 2000)
    }

    async function saveEdit(path, value) {
      setSaving(true)
      try {
        // 构建部分更新数据
        const data = {}
        if (path.startsWith('current_state.')) {
          const field = path.replace('current_state.', '')
          // value 形如 { '环境': '文本' }（label 是中文显示名，非字段名），取首个值写字段，
          // 否则 environment 会被存成 {"环境": …} 嵌套对象
          const v = value && typeof value === 'object' ? Object.values(value)[0] : value
          data.current_state = { ...(anchor.current_state || {}), [field]: v }
        } else if (path.startsWith('stm.')) {
          const idx = parseInt(path.replace('stm.', ''), 10)
          const stm = [...(anchor.memory?.stm || [])]
          stm[idx] = { ...stm[idx], ...value }
          data.memory = { stm }
        } else if (path.startsWith('ltm.')) {
          const nid = parseInt(path.replace('ltm.', ''), 10)
          const tree = JSON.parse(JSON.stringify(anchor.memory?.ltm_tree || { nodes: {}, roots: [], next_id: 1 }))
          if (tree.nodes[nid]) {
            tree.nodes[nid] = { ...tree.nodes[nid], ...value }
          }
          data.memory = { ltm_tree: tree }
        } else if (path.startsWith('kf.')) {
          const idx = parseInt(path.replace('kf.', ''), 10)
          const kf = [...(anchor.memory?.known_facts || [])]
          // 编辑后移到数组末尾——保证数组末尾 = 最近编辑的条目
          // 和 LLM 提交的合并逻辑保持一致，slice(-10) 能正确取到最近编辑的10条
          const [item] = kf.splice(idx, 1)
          kf.push({ ...item, ...value })
          data.memory = { known_facts: kf }
        }
        const result = await api('updateData', { sessionId, data })
        if (result.ok) {
          setAnchor(prev => {
            const updated = JSON.parse(JSON.stringify(prev))
            if (data.current_state) updated.current_state = data.current_state
            if (data.memory?.stm) updated.memory.stm = data.memory.stm
            if (data.memory?.ltm_tree) updated.memory.ltm_tree = data.memory.ltm_tree
            if (data.memory?.known_facts) updated.memory.known_facts = data.memory.known_facts
            return updated
          })
          setEditing(null)
          setEditDraft(null)
          // 编辑 known_facts 后自动同步到临时世界书（不等下一轮结算）
          if (data.memory?.known_facts) {
            try { await api('worldbook/settings', { sessionId, importNow: true }) } catch { /* 静默失败，不阻塞 UI */ }
          }
          showTip('✓ 已保存')
        } else {
          setError(result.error || '保存失败')
        }
      } catch (err) {
        setError(String(err.message || err))
      } finally {
        setSaving(false)
      }
    }

    async function deleteItem(path) {
      if (!confirm('确定删除这条记录吗？')) return
      try {
        const data = {}
        if (path.startsWith('stm.')) {
          const idx = parseInt(path.replace('stm.', ''), 10)
          const stm = [...(anchor.memory?.stm || [])]
          stm.splice(idx, 1)
          data.memory = { stm }
        } else if (path.startsWith('kf.')) {
          const idx = parseInt(path.replace('kf.', ''), 10)
          const kf = [...(anchor.memory?.known_facts || [])]
          kf.splice(idx, 1)
          data.memory = { known_facts: kf }
        }
        const result = await api('updateData', { sessionId, data })
        if (result.ok) {
          setAnchor(prev => {
            const updated = JSON.parse(JSON.stringify(prev))
            if (data.memory?.stm) updated.memory.stm = data.memory.stm
            if (data.memory?.known_facts) updated.memory.known_facts = data.memory.known_facts
            return updated
          })
          showTip('✓ 已删除')
        }
      } catch (err) {
        setError(String(err.message || err))
      }
    }

    async function addStm() {
      const existingStm = anchor.memory?.stm || []
      // 人工新增 STM 的轮次应用为上一条 STM 的轮次（补录性质）
      const lastTurn = existingStm.length > 0 ? (existingStm[existingStm.length - 1].turn || anchor.meta?.turn_count || 0) : (anchor.meta?.turn_count || 0)
      const newItem = {
        id: Date.now() + Math.random(),
        turn: lastTurn,
        time: '',
        location: '',
        title: '',
        summary: '',
        merged_into: null,
        manual: true
      }
      const stm = [...(anchor.memory?.stm || []), newItem]
      const result = await api('updateData', { sessionId, data: { memory: { stm } } })
      if (result.ok) {
        setAnchor(prev => ({ ...prev, memory: { ...prev.memory, stm } }))
        setEditing('stm.' + (stm.length - 1))
        setEditDraft({ ...newItem })
        showTip('✓ 已新增，点击编辑')
      }
    }

    async function addKnownFact() {
      const newItem = { entry: '', keywords: [], summary: '' }
      const kf = [...(anchor.memory?.known_facts || []), newItem]
      const result = await api('updateData', { sessionId, data: { memory: { known_facts: kf } } })
      if (result.ok) {
        setAnchor(prev => ({ ...prev, memory: { ...prev.memory, known_facts: kf } }))
        setEditing('kf.' + (kf.length - 1))
        setEditDraft({ ...newItem })
        showTip('✓ 已新增，点击编辑')
      }
    }

    function toggleLtm(id) {
      setExpandedLtm(prev => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
    }

    function toggleMerged(id) {
      setExpandedMerged(prev => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
    }

    async function load() {
      setError('')
      try {
        const result = await api('getData', { sessionId })
        if (result.ok) {
          setAnchor(result.anchor)
          setDisplay(result.display || '')
          setLoaded(true)
        } else {
          setError(result.error || '加载失败')
        }
      } catch (err) { setError(String(err.message || err)) }
    }

    React.useEffect(() => {
      void load()
      // 自动刷新（v0.6.8）：8 秒轮询 + 页面切回可见时立即刷新
      const timer = setInterval(() => void load(), 8000)
      const onVis = () => { if (!document.hidden) void load() }
      document.addEventListener('visibilitychange', onVis)
      return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVis) }
    }, [])

    if (!loaded) {
      return h('aside', { className: 'dsh-tavern-status na-page' },
        h('div', { className: 'dsh-tavern-status-head' }, h('strong', null, '叙事锚定状态')),
        h('div', { className: 'dsh-tavern-status-body' }, h('p', null, error || '加载中...'))
      )
    }

    if (!anchor) {
      return h('aside', { className: 'dsh-tavern-status na-page' },
        h('div', { className: 'dsh-tavern-status-head' }, h('strong', null, '叙事锚定状态')),
        h('div', { className: 'dsh-tavern-status-body' },
          h('p', null, '暂无叙事锚定数据。'),
          h('p', { className: 'dsh-local-help' }, '完成一轮后台结算后，数据会自动出现在这里。')
        )
      )
    }

    // 辅助：叙事备忘展示——有截断原文（focus_full）时展示全文并在截断位置插标
    function displayFocus(cs) {
      if (!cs || !cs.focus_full) return cs?.focus || ''
      const cut = cs.focus || ''
      return cs.focus_full.startsWith(cut)
        ? cut + ' ⟂截断⟂ ' + cs.focus_full.slice(cut.length)
        : cut + ' ⟂截断⟂ ' + cs.focus_full
    }

    // 辅助：可编辑文本行
    function editableField(path, label, value, multiline) {
      const text = asText(value)
      const isEditing = editing === path
      if (isEditing) {
        return h('div', { className: 'na-edit-row', style: { marginBottom: 6 } },
          h('b', { style: { display: 'block', marginBottom: 3 } }, label + '：'),
          multiline
            ? h('textarea', {
                style: { width: '100%', minHeight: 60, padding: '4px 6px', border: '1px solid var(--na-border)', borderRadius: 4, background: 'var(--na-bg-input)', color: 'var(--na-text)', resize: 'vertical' },
                value: editDraft?.[label] ?? text,
                onChange: e => setEditDraft(prev => ({ ...(prev || {}), [label]: e.target.value }))
              })
            : h('input', {
                style: { width: '100%', padding: '4px 6px', border: '1px solid var(--na-border)', borderRadius: 4, background: 'var(--na-bg-input)', color: 'var(--na-text)' },
                value: editDraft?.[label] ?? text,
                onChange: e => setEditDraft(prev => ({ ...(prev || {}), [label]: e.target.value }))
              }),
          h('div', { style: { marginTop: 4, display: 'flex', gap: 6 } },
            h('button', { className: 'dsh-local-btn na-tab-active', disabled: saving, onClick: () => saveEdit(path, { [label]: editDraft?.[label] ?? text }) }, '保存'),
            h('button', { className: 'dsh-local-btn', onClick: () => { setEditing(null); setEditDraft(null) } }, '取消')
          )
        )
      }
      return h('div', {
        className: 'na-view-row',
        style: { cursor: 'pointer', padding: '2px 4px', borderRadius: 3 },
        onClick: () => { setEditing(path); setEditDraft({ [label]: text }) },
        title: '点击编辑'
      },
        h('b', null, label + '：'),
        text || '(空)'
      )
    }

    // 数组字段编辑（环境/在场人物/关键物品/关键词）：查看用「、」连接展示，
    // 编辑为每行一项的 textarea，保存时按行切回字符串数组（与数据结构一致）
    function editableArrayField(path, label, arr) {
      const list = Array.isArray(arr) ? arr.map(asText).filter(Boolean) : (asText(arr) ? [asText(arr)] : [])
      const isEditing = editing === path
      if (isEditing) {
        return h('div', { className: 'na-edit-row', style: { marginBottom: 6 } },
          h('b', { style: { display: 'block', marginBottom: 3 } }, label + '：'),
          h('textarea', {
            style: { width: '100%', minHeight: 60, padding: '4px 6px', border: '1px solid var(--na-border)', borderRadius: 4, background: 'var(--na-bg-input)', color: 'var(--na-text)', resize: 'vertical' },
            placeholder: '每行一项',
            value: editDraft?.[label] ?? list.join('\n'),
            onChange: e => setEditDraft(prev => ({ ...(prev || {}), [label]: e.target.value }))
          }),
          h('div', { style: { marginTop: 4, display: 'flex', gap: 6 } },
            h('button', { className: 'dsh-local-btn na-tab-active', disabled: saving, onClick: () => saveEdit(path, { [label]: (editDraft?.[label] ?? list.join('\n')).split('\n').map(s => s.trim()).filter(Boolean) }) }, '保存'),
            h('button', { className: 'dsh-local-btn', onClick: () => { setEditing(null); setEditDraft(null) } }, '取消')
          )
        )
      }
      return h('div', {
        className: 'na-view-row',
        style: { cursor: 'pointer', padding: '2px 4px', borderRadius: 3 },
        onClick: () => { setEditing(path); setEditDraft({ [label]: list.join('\n') }) },
        title: '点击编辑（每行一项）'
      },
        h('b', null, label + '：'),
        list.length ? list.join('、') : '(空)'
      )
    }

    // 辅助：LTM 树节点渲染（可展开/折叠/编辑，叶节点可展开到对应 STM）
    function renderLtmNode(node, tree, depth, stmList) {
      if (!node) return null
      const isExpanded = expandedLtm.has(node.id)
      const childNodes = Array.isArray(node.children)
        ? node.children.map(cid => tree.nodes ? tree.nodes[cid] : null).filter(Boolean)
        : []
      // 该 LTM 节点对应的 STM 条目（叶节点才有，懒加载：展开时才渲染）
      const nodeStm = childNodes.length === 0 && Array.isArray(stmList)
        ? stmList.filter(s => s.merged_into == node.id)
        : []
      const hasExpandable = childNodes.length > 0 || nodeStm.length > 0
      const isEditing = editing === 'ltm.' + node.id
      const depthMark = '[L' + (node.depth || 1) + ']'
      const indent = { paddingLeft: (depth - 1) * 16 }

      return h('li', { key: node.id, style: { marginBottom: 4 } },
        h('div', { style: { ...indent, padding: '4px 6px', borderRadius: 4, background: isExpanded ? 'var(--na-bg-hover)' : 'transparent', display: 'flex', alignItems: 'flex-start', gap: 4 } },
          // 展开/折叠按钮（有子节点或对应 STM 时可展开）
          hasExpandable
            ? h('span', {
                style: { cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 18, height: 18, minWidth: 18, border: '1px solid var(--na-border)', borderRadius: 3, background: 'var(--na-bg-dim)', fontSize: 10, userSelect: 'none', marginTop: 1 },
                onClick: e => { e.stopPropagation(); toggleLtm(node.id) },
                title: isExpanded ? '点击折叠' : ('点击展开' + (childNodes.length ? '子节点（' + childNodes.length + ' 个）' : '对应 STM（' + nodeStm.length + ' 条）'))
              }, isExpanded ? '▼' : '▶')
            : h('span', { style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 18, height: 18, minWidth: 18, fontSize: 10, color: 'var(--na-dim)', marginTop: 1 } }, '•'),
          // 节点内容
          h('span', {
            style: { cursor: 'pointer', flex: 1, minWidth: 0 },
            onClick: () => { if (!isEditing) { setEditing('ltm.' + node.id); setEditDraft({ title: asText(node.title), keywords: (Array.isArray(node.keywords) ? node.keywords : []).join('、'), summary: node.summary || '' }) } }
          },
            h('b', null, depthMark + ' '),
            isEditing
              ? h('div', { style: { marginTop: 2 } },
                  h('input', {
                    style: { width: '100%', padding: '4px 6px', border: '1px solid var(--na-border)', borderRadius: 4, background: 'var(--na-bg-input)', color: 'var(--na-text)', marginBottom: 4 },
                    placeholder: '标题（12 字以内）',
                    value: editDraft?.title ?? asText(node.title),
                    onChange: e => setEditDraft(prev => ({ ...(prev || {}), title: e.target.value }))
                  }),
                  h('input', {
                    style: { width: '100%', padding: '4px 6px', border: '1px solid var(--na-border)', borderRadius: 4, background: 'var(--na-bg-input)', color: 'var(--na-text)', marginBottom: 4 },
                    placeholder: '关键词（用、分隔）',
                    value: editDraft?.keywords ?? (Array.isArray(node.keywords) ? node.keywords.join('、') : ''),
                    onChange: e => setEditDraft(prev => ({ ...(prev || {}), keywords: e.target.value }))
                  }),
                  h('textarea', {
                    style: { width: '100%', minHeight: 50, padding: '4px 6px', border: '1px solid var(--na-border)', borderRadius: 4, background: 'var(--na-bg-input)', color: 'var(--na-text)', resize: 'vertical' },
                    value: editDraft?.summary ?? asText(node.summary),
                    onChange: e => setEditDraft(prev => ({ ...(prev || {}), summary: e.target.value }))
                  })
                )
              : h('span', null,
                  node.title ? h('span', { style: { marginRight: 4 } }, asText(node.title) + '：') : null,
                  asText(node.summary) || '(无摘要)'
                )
          ),
          // 操作按钮
          h('span', { style: { display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 } },
            node.turn ? h('span', { className: 'dsh-tavern-settings-desc', style: { fontSize: 11 } }, '轮次 ' + node.turn) : null,
            childNodes.length ? h('span', { className: 'dsh-tavern-settings-desc', style: { fontSize: 11 } }, childNodes.length + '子') : null,
            nodeStm.length ? h('span', { className: 'dsh-tavern-settings-desc', style: { fontSize: 11, color: 'var(--na-info)' } }, nodeStm.length + 'STM') : null,
            isEditing
              ? h('button', { className: 'dsh-local-btn na-tab-active', style: { padding: '1px 6px', fontSize: 11 }, disabled: saving, onClick: () => saveEdit('ltm.' + node.id, {
                  title: (editDraft?.title ?? asText(node.title)).replace(/\s+/g, ' ').trim().slice(0, 12),
                  keywords: (editDraft?.keywords ?? '').split(/[、，,;；\n]+/).map(s => s.trim()).filter(Boolean),
                  summary: editDraft?.summary ?? asText(node.summary)
                }) }, '保存')
              : null,
            isEditing
              ? h('button', { className: 'dsh-local-btn', style: { padding: '1px 6px', fontSize: 11 }, onClick: () => { setEditing(null); setEditDraft(null) } }, '取消')
              : null
          )
        ),
        // 展开内容：子 LTM 节点 或 对应 STM 条目（懒加载，展开时才渲染）
        isExpanded && hasExpandable
          ? childNodes.length
            ? h('ul', { style: { listStyle: 'none', paddingLeft: 0, marginTop: 2 } },
                childNodes.map(child => renderLtmNode(child, tree, depth + 1, stmList))
              )
            : h('div', { style: { marginLeft: (depth - 1) * 16 + 28, marginTop: 4, padding: '6px 8px', border: '1px dashed var(--na-border)', borderRadius: 4, background: 'var(--na-bg-dim)' } },
                h('div', { style: { fontSize: 11, color: 'var(--na-dim)', marginBottom: 4 } }, '▼ 该 LTM 由以下 ' + nodeStm.length + ' 条 STM 合并生成：'),
                h('ol', { style: { paddingLeft: 20, margin: 0, fontSize: 12 } },
                  nodeStm.map((s, i) => h('li', { key: i, style: { marginBottom: 3 } },
                    s.summary || '(空)',
                    s.turn ? h('span', { style: { fontSize: 10, color: 'var(--na-dim)' } }, ' · 轮次 ' + s.turn) : null
                  ))
                )
              )
          : null
      )
    }

    return h('aside', { className: 'dsh-tavern-status na-page' },
      h('div', { className: 'dsh-tavern-status-head' },
        h('strong', null, '叙事锚定状态'),
        tip ? h('span', { style: { marginLeft: 8, color: 'var(--na-success)', fontSize: 12 } }, tip) : null,
        h('button', { className: 'dsh-tavern-btn', style: { marginLeft: 'auto' }, onClick: load }, '刷新')
      ),
      h('div', { className: 'dsh-tavern-status-body' },

        // 当前状态（可编辑）
        h('section', { className: 'dsh-local-section' },
          h('h3', null, '当前状态', h('span', { className: 'dsh-tavern-settings-desc', style: { marginLeft: 8, fontSize: 11, fontWeight: 'normal' } }, '点击字段编辑')),
          h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px' } },
            editableField('current_state.time', '时间', anchor.current_state?.time || ''),
            editableField('current_state.world', '世界', anchor.current_state?.world || ''),
            editableField('current_state.location', '地点', anchor.current_state?.location || ''),
            editableArrayField('current_state.environment', '环境', anchor.current_state?.environment),
            editableArrayField('current_state.characters', '在场人物', anchor.current_state?.characters),
            editableArrayField('current_state.items', '关键物品', anchor.current_state?.items),
            editableField('current_state.focus', '叙事备忘', displayFocus(anchor.current_state), true)
          )
        ),

        // STM（未合并优先展示，已合并按 LTM 节点折叠分组）
        (function() {
          const stm = anchor.memory?.stm || []
          const unmerged = stm.map((s, i) => ({ item: s, index: i })).filter(({ item }) => item.merged_into == null)
          const mergedByLtm = {}
          stm.forEach((s, i) => {
            if (s.merged_into != null) {
              const key = String(s.merged_into)
              if (!mergedByLtm[key]) mergedByLtm[key] = []
              mergedByLtm[key].push({ item: s, index: i })
            }
          })
          const tree = anchor.memory?.ltm_tree

          return h('section', { className: 'dsh-local-section' },
            h('h3', null,
              '短期记忆 (STM)',
              h('span', { className: 'dsh-tavern-settings-desc', style: { marginLeft: 8, fontSize: 11, fontWeight: 'normal' } },
                '共 ' + stm.length + ' 条 · 未合并 ' + unmerged.length + ' 条 · 已合并 ' + (stm.length - unmerged.length) + ' 条'
              ),
              h('button', { className: 'dsh-local-btn', style: { marginLeft: 'auto', float: 'right', padding: '2px 8px', fontSize: 11 }, onClick: addStm }, '+ 新增')
            ),

            // 未合并 STM（优先展示）
            unmerged.length
              ? h('div', { style: { marginBottom: 8 } },
                  h('div', { style: { fontSize: 11, color: 'var(--na-dim)', marginBottom: 4 } }, '▼ 未合并（' + unmerged.length + ' 条）'),
                  h('ol', { style: { paddingLeft: 20, margin: 0 } },
                    unmerged.map(({ item, index }) => {
                      const isEditing = editing === 'stm.' + index
                      return h('li', { key: index, style: { marginBottom: 6, padding: '4px 6px', borderRadius: 4, background: isEditing ? 'var(--na-bg-hover)' : 'transparent' } },
                        isEditing
                          ? h('div', null,
                              h('input', {
                                style: { width: '100%', padding: '4px 6px', border: '1px solid var(--na-border)', borderRadius: 4, background: 'var(--na-bg-input)', color: 'var(--na-text)', marginBottom: 4 },
                                placeholder: '标题（12 字以内）',
                                value: editDraft?.title ?? asText(item.title),
                                onChange: e => setEditDraft(prev => ({ ...(prev || {}), title: e.target.value }))
                              }),
                              h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginBottom: 4 } },
                                h('input', {
                                  style: { padding: '4px 6px', border: '1px solid var(--na-border)', borderRadius: 4, background: 'var(--na-bg-input)', color: 'var(--na-text)' },
                                  placeholder: '时间',
                                  value: editDraft?.time ?? asText(item.time),
                                  onChange: e => setEditDraft(prev => ({ ...(prev || {}), time: e.target.value }))
                                }),
                                h('input', {
                                  style: { padding: '4px 6px', border: '1px solid var(--na-border)', borderRadius: 4, background: 'var(--na-bg-input)', color: 'var(--na-text)' },
                                  placeholder: '地点',
                                  value: editDraft?.location ?? asText(item.location),
                                  onChange: e => setEditDraft(prev => ({ ...(prev || {}), location: e.target.value }))
                                })
                              ),
                              h('textarea', {
                                style: { width: '100%', minHeight: 50, padding: '4px 6px', border: '1px solid var(--na-border)', borderRadius: 4, background: 'var(--na-bg-input)', color: 'var(--na-text)', resize: 'vertical' },
                                placeholder: '内容摘要',
                                value: editDraft?.summary ?? asText(item.summary),
                                onChange: e => setEditDraft(prev => ({ ...(prev || {}), summary: e.target.value }))
                              }),
                              h('div', { style: { display: 'flex', gap: 6, marginTop: 4 } },
                                h('button', { className: 'dsh-local-btn na-tab-active', style: { padding: '2px 8px', fontSize: 11 }, disabled: saving, onClick: () => saveEdit('stm.' + index, {
                                  title: editDraft?.title ?? asText(item.title),
                                  time: editDraft?.time ?? asText(item.time),
                                  location: editDraft?.location ?? asText(item.location),
                                  summary: editDraft?.summary ?? asText(item.summary)
                                }) }, '保存'),
                                h('button', { className: 'dsh-local-btn', style: { padding: '2px 8px', fontSize: 11 }, onClick: () => { setEditing(null); setEditDraft(null) } }, '取消')
                              )
                            )
                          : h('div', { style: { cursor: 'pointer' }, onClick: () => { setEditing('stm.' + index); setEditDraft({ title: asText(item.title), time: asText(item.time), location: asText(item.location), summary: asText(item.summary) }) } },
                              item.title ? h('b', null, asText(item.title) + '：') : null,
                              asText(item.summary) || '(空)',
                              h('div', { style: { display: 'flex', gap: 8, marginTop: 2 } },
                                (item.time || item.location) ? h('span', { className: 'dsh-tavern-settings-desc', style: { fontSize: 11 } }, [item.time, item.location].filter(Boolean).map(asText).join(' · ')) : null,
                                item.turn ? h('span', { className: 'dsh-tavern-settings-desc', style: { fontSize: 11 } }, '轮次 ' + item.turn) : null,
                                h('button', { className: 'dsh-local-btn', style: { padding: '0px 6px', fontSize: 10, marginLeft: 'auto' }, onClick: e => { e.stopPropagation(); deleteItem('stm.' + index) } }, '删除')
                              )
                            )
                      )
                    })
                  )
                )
              : null,

            // 已合并 STM（大折叠块包裹，懒加载：展开时才渲染内部分组）
            Object.keys(mergedByLtm).length
              ? h('div', { style: { marginTop: 8, border: '1px solid var(--na-border)', borderRadius: 4, overflow: 'hidden' } },
                  // 大折叠块标题
                  h('div', {
                    style: { cursor: 'pointer', padding: '6px 10px', background: 'var(--na-bg-dim)', display: 'flex', alignItems: 'center', gap: 6 },
                    onClick: () => setExpandedMergedAll(prev => !prev)
                  },
                    h('span', null, expandedMergedAll ? '▼' : '▶'),
                    h('span', { style: { fontSize: 12, fontWeight: 'bold' } },
                      '已合并进 LTM 的历史 STM（共 ' + (stm.length - unmerged.length) + ' 条，分属 ' + Object.keys(mergedByLtm).length + ' 个 LTM 节点）'
                    ),
                    h('span', { className: 'dsh-tavern-settings-desc', style: { fontSize: 11, marginLeft: 'auto' } },
                      expandedMergedAll ? '点击折叠' : '点击展开查看已合并的历史 STM'
                    )
                  ),
                  // 大折叠块内容（懒加载：只有展开时才渲染）
                  expandedMergedAll
                    ? h('div', { style: { padding: '6px 8px', maxHeight: 400, overflowY: 'auto' } },
                        Object.entries(mergedByLtm).map(([ltmId, items]) => {
                          const isExpanded = expandedMerged.has(ltmId)
                          const ltmNode = tree?.nodes?.[ltmId]
                          return h('div', { key: ltmId, style: { marginBottom: 4, border: '1px solid var(--na-border)', borderRadius: 3, overflow: 'hidden' } },
                            h('div', {
                              style: { cursor: 'pointer', padding: '3px 6px', background: 'var(--na-bg-hover)', display: 'flex', alignItems: 'center', gap: 4 },
                              onClick: () => toggleMerged(ltmId)
                            },
                              h('span', { style: { fontSize: 10 } }, isExpanded ? '▼' : '▶'),
                              h('span', { style: { fontSize: 11, color: 'var(--na-dim)' } },
                                'LTM#' + ltmId + (ltmNode ? ' · ' + (ltmNode.summary || '').slice(0, 25) + '...' : '') + '（' + items.length + ' 条）'
                              )
                            ),
                            isExpanded
                              ? h('ol', { style: { paddingLeft: 20, margin: '3px 6px', fontSize: 11, color: 'var(--na-dim)' } },
                                  items.map(({ item, index }) => h('li', { key: index, style: { marginBottom: 1 } },
                                    item.summary || '(空)',
                                    item.turn ? h('span', { style: { fontSize: 9 } }, ' · 轮次 ' + item.turn) : null
                                  ))
                                )
                              : null
                          )
                        })
                      )
                    : null
                )
              : null,

            !stm.length ? h('p', { className: 'dsh-local-help' }, '暂无短期记忆，点击右上角"新增"手动添加') : null
          )
        })(),

        // LTM（树形结构，可展开/折叠/编辑，叶节点可展开到对应 STM）
        (function() {
          const tree = anchor.memory?.ltm_tree
          const stm = anchor.memory?.stm || []
          if (tree && tree.roots && tree.roots.length) {
            const totalNodes = Object.keys(tree.nodes || {}).length
            // roots 数组已在数据层按历史时序持久化排序（sortRootsInPlace），UI 直接使用该顺序
            // 不再按 depth 重排——depth 只作显示标记，不参与排序
            return h('section', { className: 'dsh-local-section' },
              h('h3', null,
                '长期记忆 (LTM)',
                h('span', { className: 'dsh-tavern-settings-desc', style: { marginLeft: 8, fontSize: 11, fontWeight: 'normal' } },
                  tree.roots.length + ' 根节点 / ' + totalNodes + ' 总结点 · 按历史时序排列 · 点击节点编辑，点击 ▶ 展开（可一直展开到叶节点的 STM）'
                )
              ),
              h('ul', { style: { listStyle: 'none', paddingLeft: 0 } },
                tree.roots.map(rid => renderLtmNode(tree.nodes[rid], tree, 1, stm))
              )
            )
          }
          return h('section', { className: 'dsh-local-section' },
            h('h3', null, '长期记忆 (LTM)'),
            h('p', { className: 'dsh-local-help' }, '暂无长期记忆。未合并 STM 达到 7 条时，后台结算会自动生成 LTM。')
          )
        })(),

        // 已知情报（可编辑/删除/新增）
        h('section', { className: 'dsh-local-section' },
          h('h3', null,
            '已知情报',
            h('span', { className: 'dsh-tavern-settings-desc', style: { marginLeft: 8, fontSize: 11, fontWeight: 'normal' } },
              (anchor.memory?.known_facts?.length || 0) + ' 条 · 点击条目编辑'
            ),
            h('button', { className: 'dsh-local-btn', style: { marginLeft: 'auto', float: 'right', padding: '2px 8px', fontSize: 11 }, onClick: addKnownFact }, '+ 新增')
          ),
          anchor.memory?.known_facts?.length
            ? h('ul', { style: { listStyle: 'none', paddingLeft: 0 } },
                anchor.memory.known_facts.map((fact, i) => {
                  const isEditing = editing === 'kf.' + i
                  return h('li', { key: i, style: { marginBottom: 6, padding: '4px 6px', borderRadius: 4, background: isEditing ? 'var(--na-bg-hover)' : 'transparent' } },
                    isEditing
                      ? h('div', null,
                          h('input', {
                            style: { width: '100%', padding: '4px 6px', border: '1px solid var(--na-border)', borderRadius: 4, background: 'var(--na-bg-input)', color: 'var(--na-text)', marginBottom: 4 },
                            placeholder: '条目名称',
                            value: editDraft?.entry ?? asText(fact.entry),
                            onChange: e => setEditDraft(prev => ({ ...(prev || {}), entry: e.target.value }))
                          }),
                          h('input', {
                            style: { width: '100%', padding: '4px 6px', border: '1px solid var(--na-border)', borderRadius: 4, background: 'var(--na-bg-input)', color: 'var(--na-text)', marginBottom: 4 },
                            placeholder: '关键词（用、分隔）',
                            value: editDraft?.keywords ?? (Array.isArray(fact.keywords) ? fact.keywords.join('、') : ''),
                            onChange: e => setEditDraft(prev => ({ ...(prev || {}), keywords: e.target.value }))
                          }),
                          h('textarea', {
                            style: { width: '100%', minHeight: 40, padding: '4px 6px', border: '1px solid var(--na-border)', borderRadius: 4, background: 'var(--na-bg-input)', color: 'var(--na-text)', resize: 'vertical' },
                            placeholder: '内容摘要',
                            value: editDraft?.summary ?? asText(fact.summary),
                            onChange: e => setEditDraft(prev => ({ ...(prev || {}), summary: e.target.value }))
                          }),
                          h('div', { style: { display: 'flex', gap: 6, marginTop: 4 } },
                            h('button', { className: 'dsh-local-btn na-tab-active', style: { padding: '2px 8px', fontSize: 11 }, disabled: saving, onClick: () => saveEdit('kf.' + i, {
                              entry: editDraft?.entry ?? asText(fact.entry),
                              keywords: (editDraft?.keywords ?? '').split(/[、，,;；\n]+/).map(s => s.trim()).filter(Boolean),
                              summary: editDraft?.summary ?? asText(fact.summary)
                            }) }, '保存'),
                            h('button', { className: 'dsh-local-btn', style: { padding: '2px 8px', fontSize: 11 }, onClick: () => { setEditing(null); setEditDraft(null) } }, '取消')
                          )
                        )
                      : h('div', { style: { cursor: 'pointer' }, onClick: () => { setEditing('kf.' + i); setEditDraft({ entry: asText(fact.entry), keywords: (Array.isArray(fact.keywords) ? fact.keywords : []).join('、'), summary: asText(fact.summary) }) } },
                          fact.entry ? h('b', null, asText(fact.entry) + '：') : null,
                          asText(fact.summary) || '(空)',
                          Array.isArray(fact.keywords) && fact.keywords.length ? h('div', { className: 'dsh-tavern-settings-desc', style: { fontSize: 10 } }, '关键词: ' + fact.keywords.join('、')) : null,
                          h('button', { className: 'dsh-local-btn', style: { padding: '0px 6px', fontSize: 10, float: 'right' }, onClick: e => { e.stopPropagation(); deleteItem('kf.' + i) } }, '删除')
                        )
                  )
                })
              )
            : h('p', { className: 'dsh-local-help' }, '暂无已知情报，点击右上角"新增"手动添加')
        ),

        error ? h('p', { className: 'dsh-local-warning' }, error) : null
      )
    )
  }

  // ========== 会话世界书管理页面组件（v0.7.2：三区块 + 检索 + 强制注入 + 退役判断）==========
  function NarrativeAnchorWorldbookTab(props) {
    const sessionId = props.scope?.sessionId || props.sessionId
    const uiConversation = props.uiConversation
    const [loaded, setLoaded] = React.useState(false)
    const [error, setError] = React.useState('')
    const [data, setData] = React.useState(null)
    const [draft, setDraft] = React.useState(null)   // { id?, title, keys, content, enabled }
    const [query, setQuery] = React.useState('')
    const [hist, setHist] = React.useState(null)
    const [histTurn, setHistTurn] = React.useState(null)
    const [expandedRefs, setExpandedRefs] = React.useState(new Set())
    const [tab, setTab] = React.useState('snapshot') // snapshot | official | temporary | sessionwb
    const [filterTags, setFilterTags] = React.useState(new Map()) // v0.9.20: 三态筛选 Map<tag,'inc'|'exc'>
    const [intersect, setIntersect] = React.useState(false) // v0.7.17ac: 多选交集(AND)
    const tagRef = React.useRef(null) // v0.7.17as: 所有标签弹出面板容器
    const [tagOpen, setTagOpen] = React.useState(false) // v0.7.17as: 所有标签弹出面板开关
    const [snapExpanded, setSnapExpanded] = React.useState(new Set()) // 快照页条目内容展开 // 标签筛选: all | 页签内标签
    const [sortBy, setSortBy] = React.useState('default') // 排序: default|title|source|status|order
    const [sortDir, setSortDir] = React.useState('asc') // 排序方向: asc|desc
    const [ctxInfo, setCtxInfo] = React.useState(null) // v0.7.17ad: 最新 reply 请求上下文（在上下文标记）
    const [predictText, setPredictText] = React.useState('') // v0.7.17ak: 当前聊天输入框文本（预测关键词命中）
    const [lastTurnText, setLastTurnText] = React.useState('') // v0.7.17am: 上一段 AI 输出（预测关键词命中文本源）
    const [ctxMenu, setCtxMenu] = React.useState(null) // v0.7.17al: 官方条目右键菜单 {x,y,ref,source,title,keys,content,enabled}
    const [offDraft, setOffDraft] = React.useState(null) // v0.7.17al: 官方条目编辑草稿 {ref,source,title,keys,content}
    const busyRef = React.useRef(false)
    const entryMetaRef = React.useRef(new Map()) // v0.7.17ap: 官方条目右键原生兜底（React 合成事件可能被桌面端干扰）
    const [bookOpen, setBookOpen] = React.useState(false) // v0.7.17aw: 临时世界书开关默认折叠
    const [tip, setTip] = React.useState('') // v0.7.17aw: 操作反馈提示
    // v0.7.18: 会话世界书绑定 + 组合
    const [combos, setCombos] = React.useState([])
    // v0.9.15: 全局自动绑定清单（新会话/分支会话自动跟随）
    const [globalAutoBind, setGlobalAutoBind] = React.useState([])
    const [libData, setLibData] = React.useState({ standalone: [], embedded: [] })
    const [comboDraft, setComboDraft] = React.useState({ name: '' })
    const [pickedBooks, setPickedBooks] = React.useState(new Set())
    const flashTip = (msg) => { setTip(msg); setTimeout(() => setTip(''), 2500) }
    const [comboPickerOpen, setComboPickerOpen] = React.useState(false)
    // v0.7.19b: 会话世界书条目列表（独立筛选状态，避免与其它页签串）
    const [sbQuery, setSbQuery] = React.useState('')
    const [sbFilterTags, setSbFilterTags] = React.useState(new Set())
    const [sbIntersect, setSbIntersect] = React.useState(false)
    const [sbInvert, setSbInvert] = React.useState(false)
    const [sbBookFilter, setSbBookFilter] = React.useState('')
    // v0.9.15: 绑定区三个列表的搜索 + 标签筛选（已绑定 / 可用世界书 / 组合）
    const [boundQ, setBoundQ] = React.useState(''); const [boundT, setBoundT] = React.useState(new Set()); const [boundInv, setBoundInv] = React.useState(false)
    const [availQ, setAvailQ] = React.useState(''); const [availT, setAvailT] = React.useState(new Set()); const [availInv, setAvailInv] = React.useState(false)
    const [comboQ, setComboQ] = React.useState(''); const [comboT, setComboT] = React.useState(new Set()); const [comboInv, setComboInv] = React.useState(false)
    // 标签筛选行（绑定区复用）：tags=当前选中集合，opts=[[v,label]]
    const bindChips = (tags, setTags, opts, invert, setInvert) => h('div', { style: { marginTop: 5, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' } },
      h('button', { className: tags.size === 0 ? 'dsh-local-btn na-tab-active' : 'dsh-local-btn', style: { padding: '2px 9px', fontSize: 11.5 }, title: '清空所有标签筛选', onClick: () => setTags(new Set()) }, '全部'),
      opts.map(([v, label]) => {
        const active = tags.has(v)
        return h('button', { key: v, className: active ? 'dsh-local-btn na-tab-active' : 'dsh-local-btn', style: { padding: '2px 9px', fontSize: 11.5 }, title: '互斥筛选：点选只看此类，点激活项取消', onClick: () => setTags(active ? new Set() : new Set([v])) }, label)
      }),
      h('label', { style: { display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11.5, color: 'var(--na-dim)', whiteSpace: 'nowrap', cursor: 'pointer', marginLeft: 2 }, title: '勾选后显示不符合所选标签的项（反选）' },
        h('input', { type: 'checkbox', checked: invert, onChange: e => setInvert(e.target.checked), style: { width: 13, height: 13, cursor: 'pointer', margin: 0 } }), '反选')
    )
    // v0.7.18: 会话世界书派生 + 动作
    const libStandalone = (libData?.standalone) || []
    const libEmbedded = (libData?.embedded) || []
    const libAll = [
      ...libStandalone.map(s => ({ kind: 'standalone', path: s.path, name: s.name, entryCount: s.entryCount })),
      ...libEmbedded.map(e => ({ kind: 'embedded', cardPath: e.cardPath, name: e.cardName || e.name, entryCount: e.entryCount }))
    ]
    const boundSet = new Set((data?.bound?.books || []).map(b => JSON.stringify({ kind: b.kind, cardPath: b.cardPath, path: b.path })))
    // v0.9.15: 全局自动绑定徽标判定
    const globalSet = new Set((globalAutoBind || []).map(b => JSON.stringify({ kind: b.kind, cardPath: b.cardPath, path: b.path })))
    const toggleGlobalBind = async (item) => {
      const book = { kind: item.kind, cardPath: item.cardPath, path: item.path }
      const r = await api('worldbook/global-bind', { action: 'toggle', book })
      if (r.ok) { setGlobalAutoBind(r.globalAutoBind || []); flashTip(r.globalAutoBind?.some(b => JSON.stringify({ kind: b.kind, cardPath: b.cardPath, path: b.path }) === JSON.stringify(book)) ? '已设为全局自动绑定（对所有会话生效，含之前解绑过的）' : '已取消全局自动绑定（各会话的手动绑定不受影响）') }
      else flashTip(r.error || '操作失败')
    }
    const togglePick = (key) => setPickedBooks(prev => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n })
    // v0.9.16: 支线系统
    const [branchInfo, setBranchInfo] = React.useState(null)
    const [branchBusy, setBranchBusy] = React.useState(false)
    const [branchNameOpen, setBranchNameOpen] = React.useState(false)
    const [branchNameDraft, setBranchNameDraft] = React.useState('')
    const createSideSession = async (alias) => {
      if (branchBusy) return
      setBranchBusy(true)
      try {
        console.log('[narrative-anchor] createSideSession effectiveSid=', effectiveSid, 'currentChatId=', currentChatId, 'scopeSessionId=', sessionId)
        const tavernRpc = async (method, args) => {
          const r = await fetch('/api/dsh-tavern/' + method, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) })
          return r.json()
        }
        // 官方 fork 三步（与官方分支按钮同一后端函数）：
        // 直接调 prepareConversationFork（turn=0 = 自动取最新），不预读磁盘快照
        const plan = await tavernRpc('prepareConversationFork', { chatId: '', sessionId: effectiveSid, turn: 0 })
        if (!plan || plan.ok === false || !plan.atSeq) { flashTip('分叉边界计算失败：' + (plan?.error || '未知')); return }
        const sourceChatId = plan.sourceId || plan.chatId || ''
        const sourceSessionId = plan.sourceSessionId || effectiveSid
        const sessions = props.sessions
        if (!sessions || typeof sessions.fork !== 'function') { flashTip('当前 DSH 版本不支持会话复制'); return }
        const targetSessionId = await sessions.fork({ sessionId: sourceSessionId, atSeq: plan.atSeq, increaseTitle: true })
        const done = await tavernRpc('forkChat', { chatId: sourceChatId, sessionId: sourceSessionId, targetSessionId, turn: plan.turn, sourceRevision: plan.sourceRevision, atSeq: plan.atSeq })
        if (!done || done.ok === false) { flashTip('支线创建失败：' + (done?.error || '未知')); return }
        const reg = await api('branch/register', { sessionId: targetSessionId, parentSid: sourceSessionId, label: alias || '' })
        console.log('[narrative-anchor] branch/register result:', reg)
        if (!reg.ok) { flashTip('支线注册失败：' + (reg.error || '未知')) }
        if (reg.ok) {
          // 设置会话标题为别名
          if (alias) {
            try { await tavernRpc('renameConversation', { sessionId: targetSessionId, title: alias }) } catch { /* 重命名失败不阻断 */ }
          }
          // 分支提示（system 角色）v0.9.21 起由后端在请求组装期注入
          // （registerMessageProjection 'narrative-anchor:branch-note'），
          // 不再走会话层写入——DSH 会把游离 system/message tombstone 掉。
          try {
            const injectRes = await api('branch/injectSystemNote', { sessionId: targetSessionId })
            console.log('[narrative-anchor] injectSystemNote:', injectRes)
          } catch (e) { console.error('[narrative-anchor] injectSystemNote error:', e) }
          // 助手消息气泡（类开场白）：改用官方 chat-history-session 的完整合成轮写法
          // （turn/start 下一轮号 → step/start → assistant/message → step/end → turn/end）
          try {
            const greetRes = await api('branch/injectGreeting', {
              sessionId: targetSessionId,
              text: '【支线开场】这里是支线「' + (alias || '新剧情') + '」。以上复制的内容来自主线，仅作为剧情背景，本会话的故事将独立展开。\n\n输入框里已为你预填了场景模板（时间/地点/人物/情景/目标/风格），填写后直接发送即可开始支线剧情；也可以直接用自然语言描述你想切入的时空与情景。主线不受本支线影响。'
            })
            console.log('[narrative-anchor] injectGreeting:', greetRes)
          } catch (e) { console.error('[narrative-anchor] injectGreeting error:', e) }
          // 自动刷新左侧对话列表（官方同款 ctx.sessions.refresh）
          if (sessions && typeof sessions.refresh === 'function') { try { await sessions.refresh() } catch { /* 刷新失败不阻断 */ } }
          // 切换到新支线会话（对齐 DSHT 官方 openSessionWhenReady 流程）
          const waitForSession = async (sid, maxMs) => {
            const deadline = Date.now() + (maxMs || 5000)
            const delays = [0, 150, 350, 700, 1200, 1800, 2500]
            let i = 0
            while (Date.now() < deadline) {
              let summary = null, binding = null
              try { summary = sessions?.list?.getSnapshot?.()?.byId?.[sid] } catch {}
              try { binding = sessions?.binding?.(sid) } catch {}
              if (summary && binding) return true
              try { await sessions?.refresh?.() } catch {}
              if (summary && binding) return true
              await new Promise(r => setTimeout(r, delays[Math.min(i, delays.length - 1)]))
              i++
            }
            return false
          }
          const ready = await waitForSession(targetSessionId)
          if (ready && sessions && typeof sessions.open === 'function') {
            try { await sessions.open(targetSessionId) } catch {}
          }
          try { await tavernRpc('markConversationOpened', { sessionId: targetSessionId }) } catch {}
          if (sessions && typeof sessions.refresh === 'function') { try { await sessions.refresh() } catch {} }
          window.dispatchEvent(new CustomEvent('dsh-tavern-session-changed', { detail: { sessionId: targetSessionId } }))
          // 触发侧边栏刷新（对齐 tavernDataChangeAffects 监听）
          window.dispatchEvent(new CustomEvent('dsh-tavern-data-changed', { detail: { kinds: ['sessions'], source: 'narrative-anchor' } }))
          // 用 DSHT 官方 API 设置输入框草稿（对齐 /setinput 命令）
          const setDraftForSession = (sid, text) => {
            try {
              const actx = props.ctx?.sessions?.scope?.(sid)
              const conversation = props.ctx?.get?.('conversation')
              if (actx && conversation && conversation.input) {
                const input = conversation.input.for(actx)
                if (input && typeof input.setDraft === 'function') { input.setDraft(text); return true }
              }
            } catch {}
            return false
          }
          const template = '（OOC： System Command - Enter side story mode, suspend the main storyline. Do not finalize or modify the original scene on transition. This is not a new scene after the previous scene concludes, but a story at an alternate time point, either in the past or future, decided by the user.）\n【场景切换/接续】\n时间：\n地点：\n人物：\n情景：\n目标：\n风格：'
          const fillTemplate = (attempt) => {
            if (setDraftForSession(targetSessionId, template)) return true
            if (attempt < 10) setTimeout(() => fillTemplate(attempt + 1), 500)
            return false
          }
          setTimeout(() => fillTemplate(0), 2000)
          flashTip('支线已创建：' + (reg.member?.label || '') + '（已知情报族内共享，LTM 以【支线】条目互通）')
          void load()
        }
        else flashTip(reg.error || '支线登记失败')
      } catch (err) { flashTip('支线创建失败：' + String(err?.message || err)) }
      finally { setBranchBusy(false) }
    }
    // v0.9.17: 支线别名修改（支线系统内部名称，不影响会话名）
    // 注意：DSHT 桌面端是 Electron，window.prompt 不可用（点击无反应），必须用行内输入
    const [editingSid, setEditingSid] = React.useState(null)
    const [editingLabel, setEditingLabel] = React.useState('')
    const [joinPick, setJoinPick] = React.useState('')
    const [mergePick, setMergePick] = React.useState('')
    const [families, setFamilies] = React.useState([])
    // 族下拉选项文字：主线别名 | 主线会话名 | 族ID尾8位标识
    // 会话名：后端 index.json 的 title（fork 新 chat 常为空串）→ 官方 sessions.list displayTitle 兜底
    const displayTitleOf = (sid) => {
      try { return String(props.sessions?.list?.getSnapshot()?.byId?.[sid]?.displayTitle || '') } catch { return '' }
    }
    const memberTitle = (m) => m.title || displayTitleOf(m.sessionId) || '（获取不到）'
    const familyOptionLabel = (f) => {
      const root = (f.members || []).find(m => m.isRoot) || (f.members || [])[0] || {}
      return (root.label || '主线') + ' | ' + memberTitle(root) + ' | ' + String(f.familyId || '').slice(-8)
    }
    const startRename = (m) => { setEditingSid(m.sessionId); setEditingLabel(m.label || '') }
    const renameBranch = async (sid) => {
      const trimmed = String(editingLabel || '').trim()
      if (!trimmed) { flashTip('别名不能为空'); return }
      try {
        const r = await api('branch/rename', { sessionId: sid, label: trimmed })
        if (r.ok) { flashTip('别名已改为：' + trimmed + (r.synced ? '（已同步 ' + r.synced + ' 条标记）' : '')); setEditingSid(null); void load() }
        else flashTip(r.error || '改名失败')
      } catch (err) { flashTip('改名失败：' + String(err?.message || err)) }
    }
    // v0.9.18: 加入族（在本会话选族）/ 解除关联 / 合并族
    const joinFamily = async (fid) => {
      if (!fid || branchBusy) return
      setBranchBusy(true)
      try {
        const r = await api('branch/bind', { sessionId: effectiveSid, familyId: fid })
        if (r.ok) { flashTip('已加入族：' + (r.member?.label || fid.slice(-8))); setJoinPick(''); void load() }
        else flashTip(r.error || '加入失败')
      } catch (err) { flashTip('加入失败：' + String(err?.message || err)) }
      finally { setBranchBusy(false) }
    }
    const unbindBranch = async (m) => {
      if (branchBusy) return
      setBranchBusy(true)
      try {
        const r = await api('branch/unbind', { sessionId: m.sessionId })
        if (r.ok) { flashTip('已解除关联：' + (m.label || '') + '（清理 ' + (r.removedEntries || 0) + ' 条互注条目）'); void load() }
        else flashTip(r.error || '解除失败')
      } catch (err) { flashTip('解除失败：' + String(err?.message || err)) }
      finally { setBranchBusy(false) }
    }
    const mergeFamily = async (sourceFid) => {
      if (!sourceFid || branchBusy) return
      setBranchBusy(true)
      try {
        const r = await api('branch/merge', { sourceFamilyId: sourceFid, targetFamilyId: branchInfo.familyId })
        if (r.ok) { flashTip('已并入本族：现在共 ' + (r.members?.length || 0) + ' 名成员'); setMergePick(''); void load() }
        else flashTip(r.error || '合并失败')
      } catch (err) { flashTip('合并失败：' + String(err?.message || err)) }
      finally { setBranchBusy(false) }
    }
    const bindSelected = async () => {
      const books = [...pickedBooks].map(k => JSON.parse(k))
      if (books.length === 0) { flashTip('先勾选要绑定的世界书'); return }
      const r = await api('worldbook/bind', { sessionId: effectiveSid, action: 'add', books })
      if (r.ok) { setPickedBooks(new Set()); flashTip('已绑定 ' + books.length + ' 本世界书'); void load() }
      else flashTip(r.error || '绑定失败')
    }
    const unbindBook = async (b) => {
      const books = [b.kind === 'embedded' ? { kind: 'embedded', cardPath: b.cardPath } : { kind: 'standalone', path: b.path }]
      const r = await api('worldbook/bind', { sessionId: effectiveSid, action: 'remove', books })
      if (r.ok) { flashTip('已解绑'); void load() } else flashTip(r.error || '解绑失败')
    }
    const saveCombo = async () => {
      const books = [...pickedBooks].map(k => JSON.parse(k))
      if (!(comboDraft.name || '').trim()) { flashTip('输入组合名'); return }
      if (books.length === 0) { flashTip('先勾选要加入组合的世界书'); return }
      const r = await api('worldbook/combos', { action: 'create', name: comboDraft.name, books })
      if (r.ok) { setCombos(r.combos || []); setPickedBooks(new Set()); setComboDraft({ name: '' }); flashTip('组合已保存') }
      else flashTip(r.error || '保存失败')
    }
    const applyCombo = async (id, mode) => {
      const r = await api('worldbook/combos', { action: 'apply', id, mode: mode || 'replace', sessionId: effectiveSid })
      if (r.ok) { flashTip(mode === 'merge' ? '已并入组合（' + (r.entryCount || 0) + ' 条）' : '已应用组合（' + (r.entryCount || 0) + ' 条，替换原绑定）'); void load() }
      else flashTip(r.error || '操作失败')
    }
    const delCombo = async (id) => {
      const r = await api('worldbook/combos', { action: 'delete', id })
      if (r.ok) { setCombos(r.combos || []); flashTip('组合已删除') } else flashTip(r.error || '删除失败')
    }
    const addPickedToCombo = async (id) => {
      const picked = [...pickedBooks].map(k => { try { return JSON.parse(k) } catch { return null } }).filter(Boolean)
      if (picked.length === 0) { flashTip('先勾选要加入组合的世界书'); return }
      const r = await api('worldbook/combos', { action: 'addBooks', id, books: picked })
      if (r.ok) { setCombos(r.combos || []); flashTip('已加入组合「' + (r.combo?.name || '') + '」') }
      else flashTip(r.error || '加入失败')
    }
    const removeComboBook = async (id, idx) => {
      const r = await api('worldbook/combos', { action: 'removeBook', id, bookIndex: idx })
      if (r.ok) { setCombos(r.combos || []); flashTip('已从组合移除') } else flashTip(r.error || '移除失败')
    }
    React.useEffect(() => {
      if (!ctxMenu) return
      const close = (e) => { if (e && e.button === 2) return; setCtxMenu(null) } // v0.7.17am：右键 mousedown 由条目 onMouseDown 打开菜单，不得被此监听误关
      document.addEventListener('mousedown', close)
      return () => document.removeEventListener('mousedown', close)
    }, [ctxMenu])
    // v0.7.17ap/ar: 原生右键兜底——window+document 双 capture × mousedown+contextmenu 四重
    // 真实右键在桌面/浏览器均不生效：疑似 DSH 前端在 document capture 拦截 mousedown；window capture 先于 document，且 contextmenu 的 preventDefault 不阻止监听器执行
    React.useEffect(() => {
      const open = (ev) => {
        if (ev.type !== 'contextmenu' && ev.button !== 2) return
        const t = ev.target
        const el = t && t.closest ? t.closest('.dsh-local-entry') : null
        if (!el) return
        const ref = el.getAttribute('data-ref')
        if (!ref) return
        const meta = entryMetaRef.current.get(ref) || {}
        setCtxMenu({ x: ev.clientX, y: ev.clientY, ref, source: meta.source || '', title: meta.title || ref, keys: meta.keys || [], content: String(meta.content || ''), enabled: meta.enabled !== false })
      }
      const tgs = [window, document]
      const tys = ['mousedown', 'contextmenu']
      tgs.forEach(tg => tys.forEach(ty => tg.addEventListener(ty, open, true)))
      return () => { tgs.forEach(tg => tys.forEach(ty => tg.removeEventListener(ty, open, true))) }
    }, [])
    // v0.7.17as: 所有标签弹出面板外部点击关闭
    React.useEffect(() => {
      if (!tagOpen) return
      const close = (e) => { if (tagRef.current && tagRef.current.contains(e.target)) return; setTagOpen(false) }
      document.addEventListener('mousedown', close)
      return () => document.removeEventListener('mousedown', close)
    }, [tagOpen])
    // v0.7.17au: 返回顶部/底部浮动按钮（原生 DOM 挂 body；滚动最近的滚动容器）
    React.useEffect(() => {
      if (document.getElementById('na-scroll-fab')) return
      const fab = document.createElement('div')
      fab.id = 'na-scroll-fab'
      fab.style.cssText = 'position:fixed;right:14px;bottom:14px;display:none;flex-direction:column;gap:6px;z-index:2147483000;'
      const mkBtn = (txt, tip, dir) => {
        const b = document.createElement('button')
        b.textContent = txt
        b.title = tip
        b.style.cssText = 'width:34px;height:34px;border-radius:50%;cursor:pointer;background:var(--na-btn,#262b36);color:var(--na-text,#dde3ec);border:1px solid var(--na-btn-border,#3a4152);font-size:16px;line-height:1;box-shadow:0 2px 8px rgba(0,0,0,.35);'
        b.addEventListener('click', () => {
          const root = document.querySelector('.dsh-tavern-settings-root')
          const sc = (root && root.scrollHeight > root.clientHeight + 10) ? root : (document.scrollingElement || document.documentElement)
          try { sc.scrollTo({ top: dir === 'top' ? 0 : sc.scrollHeight, behavior: 'smooth' }) } catch (e) { sc.scrollTop = dir === 'top' ? 0 : sc.scrollHeight }
        })
        return b
      }
      fab.appendChild(mkBtn('↑', '返回顶部', 'top'))
      fab.appendChild(mkBtn('↓', '返回底部', 'bottom'))
      document.body.appendChild(fab)
      // v0.7.17aw: 世界书页可见且内容可滚动即常驻显示（用户要求不因滚动隐藏）
      const check = () => {
        const root = document.querySelector('.dsh-tavern-settings-root')
        const r = root ? root.getBoundingClientRect() : null
        const visible = !!(r && r.width > 10 && r.height > 10)
        fab.style.display = (visible && root.scrollHeight > root.clientHeight + 10) ? 'flex' : 'none'
      }
      check()
      document.addEventListener('scroll', check, true)
      const t = setInterval(check, 1000)
      return () => { clearInterval(t); document.removeEventListener('scroll', check, true); const f = document.getElementById('na-scroll-fab'); if (f) f.remove() }
    }, [])
    // v0.7.17ax: 动态贴底——容器高度跟随实际顶部偏移（消除底部空白；顶部预留恒定，底部精确贴齐视口）
    React.useEffect(() => {
      const root = document.querySelector('.dsh-tavern-settings-root')
      if (!root) return
      const fit = () => {
        const t = root.getBoundingClientRect().top
        root.style.maxHeight = 'calc(100vh - ' + Math.max(0, t) + 'px)'
      }
      fit()
      window.addEventListener('resize', fit)
      const iv = setInterval(fit, 1500)
      return () => { window.removeEventListener('resize', fit); clearInterval(iv) }
    }, [])
    // 当前游玩 chat 的 id（uiConversation 服务，官方酒馆状态 tab 同款；scope.sessionId 注入的是工作台主会话，不可靠）
    const [currentChatId, setCurrentChatId] = React.useState(null)
    const [uiErr, setUiErr] = React.useState('')
    React.useEffect(() => {
      let unsub
      let ok = false
      const tryBind = () => {
        try {
          const uic = typeof uiConversation === 'function' ? uiConversation() : uiConversation
          // v0.9.5 修复：官方模式是 uiConversation.binding(sessionBinding)——参数必须是
          // ctx.sessions.binding(sessionId) 返回的会话绑定对象（内部读 source.sessionId）。
          // 旧代码传空对象 {} → 宿主抛 unknown session "undefined" → 永远落到 scope 模式。
          const sessionBinding = (() => { try { return props.sessions && sessionId ? props.sessions.binding(sessionId) : null } catch (e) { return null } })()
          let chat = null
          if (uic && typeof uic.binding === 'function' && sessionBinding) {
            try { chat = uic.binding(sessionBinding).target('chat') } catch (e) { chat = null }
          }
          // 官方同款回退：uiConversation 不可用/绑定失败时，直接消费 session binding
          if (!chat && sessionBinding && sessionBinding.session
            && typeof sessionBinding.session.subscribe === 'function'
            && typeof sessionBinding.session.getSnapshot === 'function') {
            chat = {
              getSnapshot: () => { const s = sessionBinding.session.getSnapshot(); return (s && (s.chat || s)) || null },
              subscribe: (fn) => sessionBinding.session.subscribe(fn)
            }
          }
          if (!chat) { setUiErr('未绑定到游玩会话（binding 不可用，已用 scope 模式，自动重试）'); return false }
            const sync = () => {
              try {
                if (!chat) { setUiErr('未绑定到游玩会话（uiConversation 无 chat，用 scope 模式）'); return }
                const snap = typeof chat.getSnapshot === 'function' ? chat.getSnapshot() : null
                const c = snap?.chat || snap
                const id = c?.id || c?.sessionId || c?.uid || null
                setCurrentChatId(id)
                setUiErr(id ? '' : 'uiConversation: chat 无 id 字段')
              } catch (e) { setUiErr('sync: ' + (e && e.message || e)) }
            }
            sync()
            unsub = typeof chat.subscribe === 'function' ? chat.subscribe(sync) : undefined
            ok = true
            return true
      } catch (e) { setUiErr('bind: ' + (e && e.message || e)); return false }
      }
      if (!tryBind()) {
        const t = setInterval(() => { if (tryBind()) clearInterval(t) }, 2000)
        return () => { clearInterval(t); if (unsub) try { unsub() } catch { /* 忽略 */ } }
      }
      return () => { if (unsub) try { unsub() } catch { /* 忽略 */ } }
    }, [])
    // v0.7.17ak：轮询聊天输入框（contenteditable），供 预测关键词命中 使用
    // v0.7.17an：间隔 800ms → 5000ms（用户要求 3-10s，取 5s 降低 DOM 扫描频率）；变更判断保留——
    //   仅当输入框文本与上次不同才 setState，值未变时零重渲染（预测标签只随 predictText/lastTurnText 变化重算）
    const predictTextRef = React.useRef('')
    React.useEffect(() => {
      const timer = setInterval(() => {
        let el = null
        const cands = document.querySelectorAll('[contenteditable="true"]')
        for (const c of cands) { if (c.offsetParent !== null) { el = c; break } }
        const v = (el?.innerText || el?.textContent || '').trim()
        if (v !== predictTextRef.current) { predictTextRef.current = v; setPredictText(v) }
      }, 5000)
      return () => clearInterval(timer)
    }, [])
    const effectiveSid = currentChatId || sessionId
    // v0.7.15：筛选统计行（官方 reason 术语；官方 labels: worldbook-recall-log.js）
    const RECALL_COUNT_LABELS = { cooldown: '冷却中', keywords: '关键词未命中', semantic: 'LLM筛选未保留' }
    const recallCountsLine = (c) => {
      if (!c) return ''
      const order = ['cooldown', 'keywords', 'semantic']
      const parts = []
      order.forEach(k => { const v = c[k]; if (v) parts.push(RECALL_COUNT_LABELS[k] + ' ' + v) })
      const other = Object.keys(c).filter(k => !order.includes(k) && k !== 'selected' && c[k]).reduce((s, k) => s + (c[k] || 0), 0)
      if (other) parts.push('其他 ' + other)
      return parts.join(' · ')
    }
    // v0.7.16：注入组成（常驻/强制）与评估组成（官方/临时），从审计现算
    // v0.7.17 用户锁定格式：注入上下文(常驻/强制/普通) · 评估(官方/临时) · 命中(关键词/语义) · 冷却 · 筛选池 · LLM筛选未保留
    const recallStatsLine = (rec) => {
      if (!rec) return null
      const entries = Array.isArray(rec.entries) ? rec.entries : []
      const refs = Array.isArray(rec.outputRefs) ? rec.outputRefs : (Array.isArray(rec.outputs) ? rec.outputs.map(o => o.ref) : [])
      const forcedSet = new Set((Array.isArray(rec.forcedRefs) ? rec.forcedRefs : []).map(String))
      const outEntries = refs.map(ref => entries.find(e => e.ref === ref)).filter(Boolean)
      const injConst = outEntries.filter(e => e.constant === true).length
      const injForced = outEntries.filter(e => forcedSet.has(e.ref)).length
      const injNormal = Math.max(0, outEntries.length - injConst - injForced)
      const evaOfficial = entries.filter(e => String(e.ref).startsWith('entry:')).length
      const evaTemp = Math.max(0, entries.length - evaOfficial)
      const sc = rec.screening || null
      const cooldown = rec.counts?.cooldown ?? 0
      const semKilled = rec.counts?.semantic ?? 0
      const pool = sc && sc.candidateCount != null ? sc.candidateCount : null
      const tok = sc && sc.estimatedTokens != null ? sc.estimatedTokens : null
      // v0.7.17l：命中段删除——命中(语义)=普通注入数，与「注入组成·普通」重复，信息已被 注入组成/筛选池/LLM筛选未保留 覆盖
      return '第 ' + (rec.turn ?? '-') + ' 轮 · 动态世界书快照 · 注入上下文 ' + outEntries.length + ' 条（常驻 ' + injConst + ' + 强制 ' + injForced + ' + 普通 ' + injNormal + '）· 评估 ' + entries.length + ' 条（官方 ' + evaOfficial + ' + 临时 ' + evaTemp + '）· 冷却中 ' + cooldown + (pool != null ? ' · 筛选池 ' + pool + ' 条约 ' + tok + ' tok' : '') + ' · LLM筛选未保留 ' + semKilled
    }

    // v0.7.17ao：数据指纹——lastTurnText(AI上轮输出)/轮次/评估规模/会话 任一变化才 setState；
    //   未变化零重渲染（此前 8s 轮询每次 setData 新对象引用 → 整页条目 predictHit 全量重算）
    const dataFpRef = React.useRef(null)
    const histFpRef = React.useRef(null)
    const combosFpRef = React.useRef(null)
    const familiesFpRef = React.useRef(null)
    const branchFpRef = React.useRef(null)
    async function load() {
      try {
        const result = await api('worldbook/get', { sessionId: effectiveSid })
        if (result.ok) {
          const lt = result.lastTurnText || ''
          const fp = [
            effectiveSid, lt.length, lt.slice(-80),
            result.recall?.turn, result.recall?.status,
            Array.isArray(result.official) ? result.official.length : -1,
            result.recall?.entriesCount, (result.recall?.forcedRefs || []).length,
            result.anchorCounts?.stm,
            // 勾选状态纳入指纹：worldbook/select 只改 selection，不含此项会导致 load() 跳过 setData、
            // 投影字段（selected/inContext）停留在旧值；用完整列表而非数量，勾 A 取消 B 的组合也能感知
            (result.book?.selection || []).join(','),
            // 条目updatedAt 纳入指纹：改别名后端会刷新条目 keys/标题，不含此项页面不实时反映
            (result.book?.entries || []).map(e => e.id + ':' + (e.updatedAt || 0)).join(','),
            (result.bound?.books || []).map(b => (b.kind === 'embedded' ? b.cardPath : b.path)).join(',') + ':' + (result.bound?.entryCount || 0)
          ].join('|')
          if (fp !== dataFpRef.current) {
            dataFpRef.current = fp
            setData(result); setLoaded(true); setCtxInfo(result.context || null); setLastTurnText(result.lastTurnText || '')
            try {
              const lr = await api('worldbook/library', {})
              if (lr.ok) setLibData({ standalone: lr.standalone || [], embedded: lr.embedded || [] })
            } catch { /* 库加载非关键 */ }
            try {
              const cr = await api('worldbook/combos', { action: 'list' })
              if (cr.ok) {
                const cfp = JSON.stringify((cr.combos || []).map(c => c.id + ':' + c.name + ':' + c.books.length)) + '|' + JSON.stringify(cr.globalAutoBind || [])
                if (cfp !== combosFpRef.current) { combosFpRef.current = cfp; setCombos(cr.combos || []); setGlobalAutoBind(cr.globalAutoBind || []) }
              }
            } catch { /* 组合加载非关键 */ }
          }
          // 族谱独立刷新（改名只动注册表不动 book 指纹，放指纹守卫外才能实时显示新别名）
          try {
            const br = await api('branch/list', { sessionId: effectiveSid })
            if (br.ok) { const bfp = JSON.stringify(br); if (bfp !== branchFpRef.current) { branchFpRef.current = bfp; setBranchInfo(br) } }
          } catch { /* 族谱加载非关键 */ }
          try {
            const fr = await api('branch/families', {})
            if (fr.ok) {
              const ffp = JSON.stringify((fr.families || []).map(f => f.familyId + ':' + (f.members || []).length).sort())
              if (ffp !== familiesFpRef.current) { familiesFpRef.current = ffp; setFamilies(fr.families || []) }
            }
          } catch { /* 族列表加载非关键 */ }
        }
        else setError(result.error || '加载失败')
      } catch (err) { setError(String(err.message || err)) }
      try {
        const hr = await api('worldbook/history', { sessionId: effectiveSid })
        if (hr.ok) {
          const h = hr.history || []
          const hfp = effectiveSid + '|' + h.length + '|' + (h[0]?.turn || '') + '|' + (h[0]?.status || '')
          if (hfp !== histFpRef.current) { histFpRef.current = hfp; setHist(h) }
        }
      } catch { /* 历史非关键，失败静默 */ }
    }

    React.useEffect(() => {
      void load()
      const timer = setInterval(() => { if (!busyRef.current) void load() }, 8000)
      const onVis = () => { if (!document.hidden && !busyRef.current) void load() }
      document.addEventListener('visibilitychange', onVis)
      return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVis) }
    }, [sessionId])

    async function call(method, payload) {
      if (busyRef.current) return null
      busyRef.current = true; setError('')
      let ok = false
      try {
        const result = await api(method, { sessionId: effectiveSid, ...payload })
        if (result.ok) { setData({ ...data, book: result.book, ...(result.selection ? { selection: result.selection } : {}) }); ok = true }
        else setError(result.error || '操作失败')
      } catch (err) { setError(String(err.message || err)) }
      busyRef.current = false
      await load()
      return ok
    }

    const book = data?.book || null
    const entries = book?.entries || []
    const anchorAuto = book?.anchorAuto || {}
    const prepared = data?.prepared || null
    const recall = data?.recall || null
    // v0.7.13：preparedWorldBook 常因磁盘快照滞后为空；并集审计 outputs（requested=实际注入）作权威
    const preparedRefs = new Set([...(prepared?.refs || []), ...(recall?.outputRefs || [])].map(r => String(r)))
    const official = data?.official || null
    const officialAll = [...(official?.embedded || []), ...(official?.external || [])]
    const selectionSet = new Set((book?.selection || []).map(String))
    const forcedSet = new Set([...(recall?.forcedRefs || []), ...((hist || []).flatMap(h => h.forcedRefs || []))].map(String))
    const ctxPresent = new Set((ctxInfo?.presentRefs || []).map(String)) // v0.7.17ad: 真实在上下文（最新 reply 请求文本命中，含工具补查）
    const q = String(query || '').trim().toLocaleLowerCase()
    const inQ = text => !q || String(text || '').toLocaleLowerCase().includes(q)

    // 快照区条目（审计）——统一 ref/title/原因/渲染状态
    const recallEntries = (recall?.entries || []).map(e => ({ ...e, ref: String(e?.ref || ''), title: String(e?.title || e?.comment || e?.ref || '') }))
    // 条目元信息映射（ref → keys/content），审计条目本身无正文，从官方/临时条目关联
    const entryMeta = new Map()
    ;[...officialAll, ...(book?.entries || []).map(e => ({ ...e, ref: 'session-wb:' + e.id })), ...(data?.bound?.entries || [])].forEach(e => { if (e && e.ref) entryMeta.set(String(e.ref), e) })
    entryMetaRef.current = entryMeta
    const metaOf = (ref) => entryMeta.get(ref) || {}
    const toggleSnap = (ref) => setSnapExpanded(prev => { const s = new Set(prev); if (s.has(ref)) s.delete(ref); else s.add(ref); return s })
    const staleMark = recall ? (prepared?.turn != null && recall.turn != null && Number(recall.turn) < Number(prepared.turn) ? ' ⚠快照/审计轮次落后' : '') : ''

    // 审计字段语义映射（reason=召回/选中方式；rendering=渲染结果）
    const reasonMap = { semantic: 'LLM筛选未保留', keywords: '关键词未命中', cooldown: '⏳冷却中', unknown: '未召回' }
    const renderMap = { rendered: '✅已注入', 'not-selected': '未注入', error: '✗错误' }
    // 来源标签（官方 external 实际为 external:<路径>，需剥前缀取文件名）
    const sourceLabel = (s) => {
      if (s === 'embedded') return { label: '内嵌', cls: 'const', full: '角色卡内嵌世界书' }
      if (s && String(s).startsWith('external:')) {
        const p = String(s).slice(9)
        return { label: '外部·' + String(p).split(/[\\/]/).pop().replace(/\.(json|yaml|yml)$/i, ''), cls: 'out', full: '外部世界书: ' + p }
      }
      if (s === 'external') return { label: '外部', cls: 'out', full: '外部世界书' }
      return { label: s || '卡', cls: 'out', full: String(s || '') }
    }
    const refSource = (ref) => {
      const r = String(ref || '')
      if (r.startsWith('session-wb:')) return { label: '临时', cls: 'temp' }
      if (r.startsWith('bound:')) return { label: '会话', cls: 'bound' }
      if (r.startsWith('entry:')) return { label: '官方', cls: 'const' }
      return { label: '未知', cls: 'out' }
    }
    // 排序
    const sortList = (list) => {
      if (!sortBy || sortBy === 'default') return list
      const arr = [...list]
      const dir = sortDir === 'desc' ? -1 : 1
      switch (sortBy) {
        case 'title': arr.sort((a, b) => dir * String(a.title || '').localeCompare(String(b.title || ''), 'zh')); break
        case 'source': arr.sort((a, b) => dir * String(a.source || '').localeCompare(String(b.source || ''), 'zh')); break
        case 'status': arr.sort((a, b) => dir * ((Number(!!b.inContext) - Number(!!a.inContext)) || String(a.reason || '').localeCompare(String(b.reason || ''), 'zh'))); break
        case 'order': arr.sort((a, b) => dir * (Number(a.outputOrder || 0) - Number(b.outputOrder || 0))); break
      }
      return arr
    }


    // 官方条目匹配审计（命中原因）与在上下文状态
    const officialWithState = officialAll.map(e => {
      const audit = recallEntries.find(r => r.ref === e.ref) || recallEntries.find(r => r.title === e.title)
      return { ...e, inContext: preparedRefs.has(e.ref), reason: audit?.reason ? (audit.reason === 'selected' ? '' : (reasonMap[audit.reason] || audit.reasonLabel || audit.reason)) : (preparedRefs.has(e.ref) ? '已注入' : '未召回'), reasonRaw: audit?.reason || null, reasonFull: audit?.reasonLabel || '', rendering: audit?.rendering || null }
    }).filter(e => inQ(e.title + ' ' + (e.keys || []).join(' ') + ' ' + e.content))

    const tempFiltered = entries.filter(e => inQ(e.title + ' ' + (e.keys || []).join(' ') + ' ' + e.content))

    const cooldownRefs = new Set((recall?.cooldownRefs || []).map(String))
    const isCooling = (ref) => cooldownRefs.has(String(ref))
    const toggleSelection = (id) => {
      const next = selectionSet.has(id)
        ? [...selectionSet].filter(x => x !== id)
        : [...selectionSet, id]
      call('worldbook/select', { entryIds: next })
    }

    const TabBtn = (id, label, count) => h('button', {
      className: tab === id ? 'dsh-local-btn na-tab-active' : 'dsh-local-btn', onClick: () => setTab(id)
    }, label + (count ? ' (' + count + ')' : ''))

    // v0.7.17ac：标签筛选。chips 互斥单选（点激活项取消）；多选框可多选，「交集」勾选=AND 否则 OR
    // v0.7.17ah：列表筛选结果计数（n=筛选后条数, m=标签筛选前条数）
    // v0.7.17am：预测文本源 = 当前输入框文本 + 上一段 AI 输出（DSHT 世界书关键词匹配的真实文本范围）
    const predictSource = ((predictText || '') + '\n' + (lastTurnText || '')).trim()
    // v0.7.17ak：预测关键词命中（对齐 DSHT worldbook-activation keyMatch/literalMatch：正则key/大小写不敏感子串/单字中文独立成词）
    const predictHit = (keys, text) => {
      if (!text || !Array.isArray(keys) || keys.length === 0) return false
      const source = text.toLocaleLowerCase()
      return keys.some(k => {
        const key = String(k || '').trim()
        if (!key) return false
        const rm = /^\/(.*)\/([dgimsuvy]*)$/.exec(key)
        if (rm) { try { return new RegExp(rm[1], rm[2].replaceAll('g', '').replaceAll('y', '')).test(text) } catch (e) { return false } }
        const needle = key.toLocaleLowerCase()
        if (needle === '') return false
        if (/^\p{Script=Han}$/u.test(needle)) return new RegExp('(?:^|[^\\p{L}\\p{N}\\p{M}_])' + needle + '(?=$|[^\\p{L}\\p{N}\\p{M}_])', 'u').test(source)
        return source.includes(needle)
      })
    }
    const countBar = (nn, mm) => h('div', { style: { fontSize: 11, color: 'var(--na-dim)', margin: '6px 2px 4px', whiteSpace: 'nowrap' } },
      '共 ' + mm + ' 条' + (nn !== mm ? ' · 筛选 ' + nn + ' 条' : ''))
    const matchTag = (tags, f, useIntersect, useInvert) => {
      if (!tags || tags.size === 0) return true
      const ok = (t) => {
        switch (t) {
          case 'embedded': return !!f.embedded
          case 'external': return !!f.external
          case 'inctx': return !!f.inctx
          case 'recalled': return !!f.recalled
          case 'notrecalled': return !f.recalled
          case 'constant': return !!f.constant
          case 'disabled': return !!f.disabled
          case 'anchor': return !!f.anchor
          case 'sideline': return !!f.sideline
          case 'manual': return !!f.manual
          case 'forced': return !!f.forced
          case 'rendered': return !!f.rendered
          case 'notsel': return !!f.notsel
          case 'sel': return !!f.sel
          case 'cooldown': return !!f.cooldown
          case 'semkill': return !!f.semkill
          case 'kwmiss': return !!f.kwmiss
          case 'official': return !!f.official
          case 'temp': return !!f.temp
          case 'bound': return !!f.bound
          case 'prevForced': return !!f.prevForced
          case 'pred': return !!f.pred
          case 'global': return !!f.global
          case 'unavail': return !!f.unavail
          default: return false
        }
      }
      let m
      // v0.9.20：三态筛选——filterTags 为 Map<tag,'inc'|'exc'>；兼容旧 Set（bind 区不用 matchTag，仅防御）
      const inc = [], exc = []
      if (tags && typeof tags.forEach === 'function') tags.forEach((st, t) => { (st === 'exc' ? exc : inc).push(t) })
      else if (tags && tags.size) for (const t of tags) inc.push(t)
      if (inc.length === 0 && exc.length === 0) return true
      const anyOk = (list) => { for (const t of list) if (ok(t)) return true; return false }
      const allOk = (list) => { for (const t of list) if (!ok(t)) return false; return true }
      const passInc = inc.length === 0 ? true : (useIntersect ? allOk(inc) : anyOk(inc))
      const passExc = exc.length === 0 ? true : !anyOk(exc)
      m = passInc && passExc
      return m
    }
    // v0.9.19：临时条目可见集（搜索词 + 标签筛选，与列表渲染完全一致）——导出/清空共用
    const visibleTemp = sortList(tempFiltered.filter(e => matchTag(filterTags, { anchor: e.source === 'anchor', sideline: e.source === 'sideline', manual: e.source !== 'anchor' && e.source !== 'sideline', forced: selectionSet.has('session-wb:' + e.id), inctx: ctxPresent.has('session-wb:' + e.id), disabled: e.enabled === false, cooldown: isCooling('session-wb:' + e.id), pred: predictHit(e.keys, predictSource) }, intersect)))
    const FilterChips = (opts) => h('div', { style: { display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' } },
      h('button', { key: '__all', className: filterTags.size === 0 ? 'dsh-local-btn na-tab-active' : 'dsh-local-btn', style: { padding: '2px 9px', fontSize: 11.5 }, title: '清空所有标签筛选', onClick: () => setFilterTags(new Map()) }, '全部'),
      opts.map(o => {
        const st = filterTags.get(o.v) // undefined=未选中 'inc'=选中 'exc'=反选
        const style = { padding: '2px 9px', fontSize: 11.5 }
        if (st === 'exc') { style.background = '#c64545'; style.borderColor = '#c64545'; style.color = '#fff' }
        return h('button', {
          key: o.v,
          className: st === 'inc' ? 'dsh-local-btn na-tab-active' : 'dsh-local-btn',
          style,
          title: '互斥三态：点选只看此类（清掉其他 chip 状态）→ 再点反选（红 ✖）→ 再点取消；多选组合请用「所有标签」下拉',
          onClick: () => { const cur = filterTags.get(o.v); const m = new Map(); if (!cur) m.set(o.v, 'inc'); else if (cur === 'inc') m.set(o.v, 'exc'); setFilterTags(m) }
        }, (st === 'inc' ? '✔' : st === 'exc' ? '✖' : '') + o.label)
      })
    )
    // v0.7.17t：标签定义单一数据源。顺序 = 条目徽标从左到右；chip=true 进常用 chips，全量进「所有标签」多选框
    const tagDefs = {
      official: [
        {v:'embedded',label:'内嵌',chip:true},{v:'external',label:'外部',chip:true},
        
        {v:'inctx',label:'📌在上下文',chip:true},{v:'constant',label:'常驻',chip:true},{v:'disabled',label:'停用',chip:true},
        {v:'sel',label:'⚡强制注入',chip:true}
,{v:'pred',label:'预测命中',chip:true}
      ],
      temporary: [
        {v:'anchor',label:'锚点',chip:true},{v:'sideline',label:'支线',chip:true},{v:'manual',label:'人工',chip:true},
        {v:'forced',label:'⚡强制注入',chip:true},{v:'inctx',label:'📌在上下文',chip:true},
        {v:'cooldown',label:'⏳冷却中'},{v:'disabled',label:'已停用',chip:true}
,{v:'pred',label:'预测命中',chip:true}
      ],
      snapshot: [
        {v:'official',label:'官方'},{v:'temp',label:'临时'},{v:'bound',label:'会话'},
        {v:'rendered',label:'✅已注入',chip:true},{v:'notsel',label:'未注入',chip:true},
        {v:'cooldown',label:'⏳冷却中',chip:true},{v:'kwmiss',label:'关键词未命中'},
        {v:'semkill',label:'LLM筛选未保留',chip:true},{v:'prevForced',label:'⚡前轮强制注入',chip:true},
        {v:'inctx',label:'📌在上下文',chip:true},{v:'constant',label:'常驻'}
      ]
    }
    // v0.7.17as: 自定义弹出多选（原生 <select multiple> 在 Edge 显示为滚动框且点击即单选，弃用）
    const TagMultiSelect = (opts) => h('div', { ref: tagRef, style: { position: 'relative', display: 'inline-flex', alignItems: 'center' } },
      h('button', { className: filterTags.size ? 'dsh-local-btn na-tab-active' : 'dsh-local-btn', style: { padding: '2px 9px', fontSize: 11.5 }, title: '所有标签（点击弹出，可多选；外部点击关闭）', onClick: () => setTagOpen(v => !v) },
        '▾ 所有标签' + (filterTags.size ? ' · ' + filterTags.size : '')),
      tagOpen ? h('div', { style: { position: 'absolute', top: '100%', left: 0, zIndex: 9999, background: 'var(--na-card)', border: '1px solid var(--na-border)', borderRadius: 7, padding: 6, maxHeight: 300, overflowY: 'auto', minWidth: 150, boxShadow: '0 6px 18px rgba(0,0,0,.4)' } },
        opts.map(o => {
          const st = filterTags.get(o.v)
          return h('label', { key: o.v, style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, padding: '3px 6px', cursor: 'pointer', whiteSpace: 'nowrap', color: st === 'exc' ? '#ff9c9c' : st === 'inc' ? 'var(--na-accent)' : 'var(--na-text)', borderRadius: 5 },
            title: '三态：点击选中 → 再点反选 → 再点取消',
            onClick: (ev) => { ev.preventDefault(); const m = new Map(filterTags); const cur = m.get(o.v); if (!cur) m.set(o.v, 'inc'); else if (cur === 'inc') m.set(o.v, 'exc'); else m.delete(o.v); setFilterTags(m) } },
            h('span', { style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 15, height: 15, borderRadius: 3, fontSize: 11, lineHeight: 1, background: st === 'inc' ? 'var(--na-accent)' : st === 'exc' ? '#c64545' : 'transparent', border: st ? 'none' : '1px solid var(--na-border)', color: '#fff' } }, st === 'inc' ? '✔' : st === 'exc' ? '✖' : ''),
            o.label)
        }))
      : null)
    // v0.7.17c：页签内工具栏（检索+筛选+排序），紧挨条目列表
    const renderToolbar = (tabKey) => h('div', null,
      h('input', { className: 'dsh-local-input', style: { width: '100%', marginTop: 6 }, placeholder: '检索：标题 / 关键词 / 正文（当前页签内过滤）', value: query || '', onChange: e => setQuery(e.target.value) }),
      h('div', { style: { marginTop: 7, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' } },
        FilterChips((tagDefs[tabKey] || tagDefs.official).filter(d => d.chip)),
        TagMultiSelect(tagDefs[tabKey] || tagDefs.official),
        h('label', { style: { display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11.5, color: 'var(--na-dim)', whiteSpace: 'nowrap', cursor: 'pointer', marginLeft: 2 }, title: '勾选后多个标签需同时满足（AND）；不勾选为任一满足（OR）。反选请直接把标签点成红色 ✖' },
          h('input', { type: 'checkbox', checked: intersect, onChange: e => setIntersect(e.target.checked), style: { width: 13, height: 13, cursor: 'pointer', margin: 0 } }),
          '交集'),
        h('select', { className: 'dsh-local-input', style: { marginLeft: 'auto', minHeight: 26, fontSize: 11.5, width: 'auto' }, value: sortBy, onChange: e => setSortBy(e.target.value) },
          h('option', { value: 'default' }, '排序: 默认'),
          h('option', { value: 'title' }, '排序: 标题'),
          h('option', { value: 'source' }, '排序: 来源'),
          h('option', { value: 'status' }, '排序: 注入状态'),
          h('option', { value: 'order' }, '排序: 输出顺序')
        ),
        h('button', { className: 'dsh-local-btn', style: { minHeight: 26, padding: '2px 9px', fontSize: 11.5 }, title: sortDir === 'asc' ? '升序（点击切换降序）' : '降序（点击切换升序）', onClick: () => setSortDir(sortDir === 'asc' ? 'desc' : 'asc') }, sortDir === 'asc' ? '↑升' : '↓降')
      )
    )

    return h('div', { className: 'dsh-tavern-settings-root na-page', style: { minHeight: 'calc(100vh - 44px)', maxHeight: 'calc(100vh - 44px)', overflowY: 'auto' } },
      h('h2', null, '会话世界书管理'),
      tip ? h('div', { style: { background: 'var(--na-accent-soft)', border: '1px solid var(--na-accent)', color: 'var(--na-text)', borderRadius: 8, padding: '6px 10px', fontSize: 12, marginBottom: 8 } }, tip) : null,
      !sessionId ? h('p', { className: 'dsh-local-help' }, '请打开一个游玩会话后再查看') :

      h('div', null,
        // ── 开关区 ──
        h('section', { className: 'dsh-local-section' },
          h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }, onClick: () => setBookOpen(!bookOpen) },
            h('h3', { style: { margin: 0 } }, (bookOpen ? '▾ ' : '▸ ') + '临时世界书开关'),
            h('span', { style: { fontSize: 11, color: 'var(--na-dim)', fontWeight: 600 } }, book?.enabled ? '已启用' : '已停用')
          ),
          bookOpen ? h('div', null,
          h('label', { className: 'dsh-local-label' },
            h('span', null,
              '启用会话临时世界书',
              h('span', { className: 'dsh-tavern-settings-desc' }, '开启后本会话的临时条目并入 DSHT 原生世界书召回（关键词 / Agent 筛选）')
            ),
            h('input', { type: 'checkbox', checked: !!book?.enabled, onChange: e => call('worldbook/settings', { enabled: e.target.checked }) })
          ),
          h('label', { className: 'dsh-local-label' },
            h('span', null,
              '结算后自动将锚点数据流入临时世界书',
              h('span', { className: 'dsh-tavern-settings-desc' }, '每轮后台结算时，自动把叙事锚点数据写入临时世界书（按下方四项勾选）')
            ),
            h('input', { type: 'checkbox', checked: !!book?.autoFromAnchor, onChange: e => call('worldbook/settings', { autoFromAnchor: e.target.checked }) })
          ),
          // [2026-09-29 暂停] 当前状态已通过 foreground 每轮注入，世界书流入无意义，隐藏开关
          // h('label', { className: 'dsh-local-label' },
          //   h('span', null,
          //     '自动流入：当前状态',
          //     h('span', { className: 'dsh-tavern-settings-desc' }, '时间 / 世界 / 地点 / 在场人物 / 环境 / 关键物品')
          //   ),
          //   h('input', { type: 'checkbox', checked: anchorAuto.currentState !== false, onChange: e => call('worldbook/settings', { anchorAuto: { currentState: e.target.checked } }) })
          // ),
          h('label', { className: 'dsh-local-label' },
            h('span', null,
              '自动流入：已知情报',
              h('span', { className: 'dsh-tavern-settings-desc' }, '已证实的关键设定 / 情报条目')
            ),
            h('input', { type: 'checkbox', checked: anchorAuto.knownFacts !== false, onChange: e => call('worldbook/settings', { anchorAuto: { knownFacts: e.target.checked } }) })
          ),
          h('label', { className: 'dsh-local-label' },
            h('span', null,
              '自动流入：长期记忆',
              h('span', { className: 'dsh-tavern-settings-desc' }, 'LTM 长期记忆压缩摘要；载入的条目默认停用，需手动启用才参与关键词召回')
            ),
            h('input', { type: 'checkbox', checked: anchorAuto.ltm === true, onChange: e => call('worldbook/settings', { anchorAuto: { ltm: e.target.checked } }) })
          ),
          // [2026-09-29 暂停] 大纲路线暂时不单独维护，剧情信息自然流入STM
          // h('label', { className: 'dsh-local-label' },
          //   h('span', null,
          //     '自动流入：剧情大纲',
          //     h('span', { className: 'dsh-tavern-settings-desc' }, '当前节点 / 前情衔接 / 下一幕规划')
          //   ),
          //   h('input', { type: 'checkbox', checked: anchorAuto.plotRoute === true, onChange: e => call('worldbook/settings', { anchorAuto: { plotRoute: e.target.checked } }) })
          // ),
          h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 } },
            h('button', { className: 'dsh-local-btn', title: '立刻按上方勾选，把当前叙事锚点数据导入临时世界书（不等后台结算）', onClick: async () => { const ok = await call('worldbook/settings', { importNow: true }); if (ok) flashTip('✓ 已从锚点导入临时世界书') } }, '立即从锚点导入'),
            h('button', { className: 'dsh-local-btn', title: '清除所有已勾选的「强制注入」条目（selection 列表清空）', onClick: async () => { const ok = await call('worldbook/select', { clear: true }); if (ok) flashTip('✓ 已清空强制注入选择') } }, '清空注入选择')
          )
          ) : null
        ),

        // ── 页签导航 ──
        h('section', { className: 'dsh-local-section' },
          h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' } },
            TabBtn('snapshot', '动态快照', recallEntries.length),
            TabBtn('official', '官方世界书', officialAll.length),
            TabBtn('temporary', '临时条目', entries.length),
            TabBtn('sessionwb', '会话世界书', (data?.bound?.entryCount) || 0)
          )
        ),

        // ── 强制注入提示条 ──
        selectionSet.size > 0 ? h('div', { className: 'na-inject-bar' }, '⚡ 已选 ' + selectionSet.size + ' 条强制注入，下一次回复生效（force 激活：过筛选豁免 + 守 10 轮冷却）') : null,

        // ── 页签：动态快照 ──
        tab === 'snapshot' ? h('section', { className: 'dsh-local-section' },
          h('h3', null, '动态世界书快照（DSHT 原生召回）' + (staleMark || '')),
          prepared ? h('p', { className: 'dsh-local-help' }, '模式: ' + (prepared.mode || '-') + ' · 快照轮: ' + (prepared.turn ?? '-') + (recall ? ' · 审计轮: ' + (recall.turn ?? '-') + ' · 状态: ' + (recall.status || '-') : '') + ' · 字符: ' + (prepared.contextChars || 0) + '/' + (prepared.totalChars || 0)) : null,
          h('p', { className: 'dsh-local-help', style: { margin: '6px 0 2px' } }, (() => { const src = histTurn != null ? (hist || []).find(r => Number(r.turn) === histTurn) : recall; return recallStatsLine(src) })()),
          h('details', { className: 'dsh-local-help', style: { marginBottom: 6 } },
            h('summary', { style: { cursor: 'pointer' } }, '这是什么？筛选流程 + 标签说明（点击展开）'),
            h('p', { style: { margin: '6px 0 2px', fontSize: 11.5 } }, '每次回复前，DSHT 会自动从你绑定的世界书里挑条目注入上下文（= 动态世界书快照）。下表 = 最新一轮的挑选结果。挑选流程：'),
            h('div', { style: { margin: '6px 0', fontSize: 11 } },
              h('div', { style: { border: '1px solid #555', borderRadius: 5, padding: '4px 7px', background: 'rgba(255,255,255,.04)' } }, h('b', { style: { display: 'block' } }, '① 关键词匹配'), h('span', null, '除「常驻」和「你勾选的强制注入」外，每个条目都要在本轮内容里找自己的关键词；没找到 → 淘汰（关键词未命中）')),
              h('div', { style: { textAlign: 'center', color: '#888', lineHeight: '14px' } }, '↓'),
              h('div', { style: { border: '1px solid #555', borderRadius: 5, padding: '4px 7px', background: 'rgba(255,255,255,.04)' } }, h('b', { style: { display: 'block' } }, '② 候选池 → AI 复核'), h('span', null, '关键词命中的条目组成候选池；池子不大（≤5条且≤2000字）直接全保留，大则由后台 AI 词面预筛 + 逐条判断，只留相关的（没留 → LLM筛选未保留）')),
              h('div', { style: { textAlign: 'center', color: '#888', lineHeight: '14px' } }, '↓'),
              h('div', { style: { border: '1px solid #555', borderRadius: 5, padding: '4px 7px', background: 'rgba(255,255,255,.04)' } }, h('b', { style: { display: 'block' } }, '③ 注入快照'), h('span', null, '常驻直通 + 强制注入直通 + 通过 AI 复核的普通条目 → 写进上下文，进入「动态世界书快照」')),
              h('div', { style: { textAlign: 'center', color: '#888', lineHeight: '14px' } }, '↓'),
              h('div', { style: { border: '1px solid #555', borderRadius: 5, padding: '4px 7px', background: 'rgba(255,255,255,.04)' } }, h('b', { style: { display: 'block' } }, '④ 冷却'), h('span', null, '注入过的条目 10 轮内不再自动出现；正文被编辑 / 重新生成时立即解除'))
            ),
            h('p', { style: { margin: '2px 0 6px', fontSize: 11, opacity: .8 } }, '「强制注入」（勾选）跳过 ①② 直接进 ③，AI 不能把它筛掉；但同样守 10 轮冷却。'),
            h('p', { style: { margin: '2px 0 6px', fontSize: 11, opacity: .8 } }, '另有一条独立通道「主动补查」：正文 AI 缺资料时可临时搜索世界书（不进快照、无冷却、只活在当轮上下文）。'),
            h('b', { style: { display: 'block', marginTop: 6 } }, '条目徽标（从左到右）：'),
            h('ul', { style: { margin: '6px 0 0', paddingLeft: 18, fontSize: 11.5, lineHeight: 1.75 } },
              h('li', null, '官方 / 临时：来源——角色卡或外部世界书文件 / 本插件创建的会话临时条目。'),
              h('li', null, '✅已注入 / 未注入：这一轮有没有真写进上下文。'),
              h('li', null, '⏳冷却中：正在 10 轮冷却，本轮不参与挑选（刚注入的条目从下一轮筛选起进入冷却；注入当轮显示 已注入 / ⚡前轮强制注入）。'),
              h('li', null, '关键词未命中：关键词没在本轮出现，第一步就被淘汰。'),
              h('li', null, 'LLM筛选未保留：进了候选池，但被后台 AI 筛掉了。'),
              h('li', null, '⚡前轮强制注入：之前几轮实际以强制身份注入的条目（勾选操作在官方 / 临时页签进行）。'),
              h('li', null, '常驻：每轮固定注入，不看关键词。'),
              h('li', null, '输出#N：在快照中的写入顺序。')
            )
          ),
          renderToolbar('snapshot'),
          (hist && hist.length > 1) ? h('div', { style: { marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
            h('span', { className: 'dsh-local-help', style: { fontSize: 11, opacity: .75, margin: 0 } }, '历史轮次:'),
            (() => {
              const turns = hist.slice().reverse() // 最新在前
              const chips = turns.slice(0, 3)      // 最近 3 轮
              const rest = turns.slice(3)          // 其余走下拉
              const turnBtn = (v, label, hint) => {
                const active = (histTurn ?? '') === v
                return h('button', {
                  key: v, className: 'dsh-local-btn',
                  style: {
                    minHeight: 24, padding: '1px 9px', fontSize: 11,
                    borderColor: active ? 'var(--na-accent)' : undefined,
                    color: active ? 'var(--na-accent)' : undefined,
                    fontWeight: active ? 600 : 400,
                    background: active ? 'var(--na-card-hover)' : undefined
                  },
                  title: hint, onClick: () => setHistTurn(v ? Number(v) : null)
                }, label)
              }
              const hintOf = r => r ? ('注入 ' + (r.outputs?.length || 0) + ' 条 · 快照 ' + (r.entriesCount || 0) + ' 条') : '实时最新轮'
              return [
                turnBtn('', '最新', hintOf(null)),
                ...chips.map(r => turnBtn(String(r.turn), '第' + r.turn + '轮' + (r.status === 'requested' ? '·已注入' : ''), hintOf(r))),
                rest.length ? h('select', { key: 'more', className: 'dsh-local-input', style: { minHeight: 24, fontSize: 11, maxWidth: 150 }, value: (histTurn != null && rest.some(r => String(r.turn) === String(histTurn))) ? String(histTurn) : '', onChange: e => setHistTurn(e.target.value ? Number(e.target.value) : null) },
                  h('option', { value: '' }, '更多轮次 ▾'),
                  rest.map(r => h('option', { key: r.turn, value: String(r.turn) }, '第 ' + r.turn + ' 轮 · ' + (r.status === 'requested' ? '已注入' : '未发送') + ' · 注入 ' + (r.outputs?.length || 0) + ' 条'))
                ) : null
              ]
            })()
          ) : null,
          histTurn != null ? (() => {
            const hh = (hist || []).find(r => Number(r.turn) === histTurn)
            if (!hh) return h('p', { className: 'dsh-local-help' }, '该轮无审计数据')
            return h('div', null,
              h('p', { className: 'dsh-local-help', style: { marginTop: 6 } }, '本轮注入条目:'),
              (hh.outputs && hh.outputs.length) ? h('div', null, hh.outputs.map((o, i) => h('div', { key: o.ref || i, className: 'dsh-local-entry', style: { border: '1px solid #444', borderRadius: 6, padding: '6px 8px', marginBottom: 6 } },
                h('b', null, o.ref || ('#' + i)),
                h('p', { style: { margin: '2px 0 0', fontSize: 12, whiteSpace: 'pre-wrap' } }, String(o.text || ''))
              ))) : h('p', { className: 'dsh-local-help' }, '该轮无实际注入条目' + (hh.status === 'requested' ? '（结算中断，未产出快照）' : ''))
            )
          })() :
          (recallEntries.length === 0 ? h('p', { className: 'dsh-local-help' }, preparedRefs.size ? '快照存在但暂无审计记录（筛选/审计可能未运行或已欠费中断）' : (hist && hist.length ? '最新轮无召回数据（未发送或本轮无变化）' : '暂无召回审计。发出正文后自动产生。')) :
          h('div', null, countBar(sortList(recallEntries.filter(r => inQ(r.title + ' ' + (r.reason || '') + ' ' + (r.reasonLabel || '')) && matchTag(filterTags, { rendered: r.rendering === 'rendered', notsel: r.rendering === 'not-selected', recalled: preparedRefs.has(r.ref), sel: selectionSet.has(r.ref), cooldown: r.reason === 'cooldown', semkill: r.reason === 'semantic', kwmiss: r.reason === 'keywords', constant: r.constant === true, official: refSource(r.ref).cls === 'const', temp: refSource(r.ref).cls === 'temp', bound: refSource(r.ref).cls === 'bound', prevForced: forcedSet.has(r.ref), inctx: ctxPresent.has(r.ref) }, intersect))).length, recallEntries.length), sortList(recallEntries.filter(r => inQ(r.title + ' ' + (r.reason || '') + ' ' + (r.reasonLabel || '')) && matchTag(filterTags, { rendered: r.rendering === 'rendered', notsel: r.rendering === 'not-selected', recalled: preparedRefs.has(r.ref), sel: selectionSet.has(r.ref), cooldown: r.reason === 'cooldown', semkill: r.reason === 'semantic', kwmiss: r.reason === 'keywords', constant: r.constant === true, official: refSource(r.ref).cls === 'const', temp: refSource(r.ref).cls === 'temp', bound: refSource(r.ref).cls === 'bound', prevForced: forcedSet.has(r.ref), inctx: ctxPresent.has(r.ref) }, intersect))).map((r, i) => { const rs = refSource(r.ref); let meta = entryMeta.get(r.ref); if (!meta && r.title) meta = [...entryMeta.values()].find(m => String(m?.title || '') === r.title); const kArr = Array.isArray(meta?.keys) ? meta.keys : []; const hitKeys = Array.isArray(r?.match?.primary) ? r.match.primary.map(m => String(m?.key || '')).filter(Boolean) : []; const hitExcerpts = Array.isArray(r?.match?.primary) ? r.match.primary.map(m => String(m?.excerpt || '')).filter(Boolean) : []; const open = snapExpanded.has(r.ref); return h('div', { key: r.ref || i, className: 'dsh-local-entry', style: { border: '1px solid #333', borderRadius: 6, padding: '6px 8px', marginBottom: 6 } },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', cursor: 'pointer' }, title: open ? '收起内容' : '点击展开关键词与内容', onClick: () => toggleSnap(r.ref) },
              h('b', null, (open ? '▾ ' : '▸ ') + (r.title || r.ref)),
              h('span', { className: 'na-badge na-b-' + rs.cls, title: r.ref }, rs.label),
              (r.rendering === 'rendered' ? h('span', { className: 'na-badge na-b-in' }, '✅已注入') : r.rendering === 'not-selected' ? h('span', { className: 'na-badge na-b-out' }, '未注入') : r.rendering ? h('span', { className: 'na-badge na-b-off' }, '✗' + r.rendering) : null),
              (ctxPresent.has(r.ref) ? h('span', { className: 'na-badge na-b-ctx', title: '出现在最新一轮模型请求上下文（含工具补查）' }, '📌在上下文') : null),
              (r.reason && r.reason !== 'selected' ? h('span', { className: 'na-badge na-b-warn', title: r.reasonLabel || '' }, (r.reason && reasonMap[r.reason]) ? reasonMap[r.reason] : (r.reasonLabel || r.reason || '?')) : null),
              (forcedSet.has(r.ref) ? h('span', { className: 'na-badge na-b-force' }, '⚡前轮强制注入') : null),
              (r.constant === true ? h('span', { className: 'na-badge na-b-constant' }, '常驻') : null),
              r.outputOrder ? h('span', { className: 'na-badge na-b-const' }, '输出#' + r.outputOrder) : null
            ),
            h('p', { style: { marginTop: 2, marginBottom: 0, fontSize: 10.5, opacity: .7 } }, kArr.length ? '关键词: ' + kArr.join('、') : hitKeys.length ? '命中词: ' + hitKeys.join('、') + '（审计命中词）' : (meta || !String(r.ref || '').startsWith('entry:')) ? '无关键词（仅 Agent 判断 / 强制注入）' : '条目元信息未关联此 ref（旧轮次条目或官方列表已变更）'),
            (open && meta?.content) ? h('p', { style: { marginTop: 4, marginBottom: 0, fontSize: 11.5, whiteSpace: 'pre-wrap', borderTop: '1px dashed #444', paddingTop: 4 } }, String(meta.content)) : (open && hitExcerpts.length ? h('p', { style: { marginTop: 4, marginBottom: 0, fontSize: 11.5, whiteSpace: 'pre-wrap', borderTop: '1px dashed #444', paddingTop: 4 } }, '命中摘录: ' + hitExcerpts.join(' … ')) : null)
          ) })))
        ) : null,

        // ── 页签：官方世界书 ──
        tab === 'official' ? h('section', { className: 'dsh-local-section' },
          // [v0.9.5] 官方条目编辑改为弹层
          offDraft ? h(EditModal, {
            title: '编辑条目：' + (offDraft.title || offDraft.ref),
            onClose: () => setOffDraft(null),
            footer: [
              h('button', { key: 'cancel', className: 'dsh-local-btn', onClick: () => setOffDraft(null) }, '取消'),
              h('button', { key: 'save', className: 'dsh-local-btn na-tab-active', onClick: async () => {
                if (!offDraft.title && !offDraft.content) return
                await call('worldbook/entry', { action: 'update', source: offDraft.source, entry: { ref: offDraft.ref, title: offDraft.title || '', keys: (offDraft.keys || '').split(/\s+/).filter(Boolean), content: offDraft.content || '' } })
                setOffDraft(null)
                load()
              } }, '保存修改')
            ]
          },
            h('p', { key: 'hint', className: 'dsh-local-help', style: { margin: '0 0 6px' } }, '直接写回 ' + (offDraft.source ? (offDraft.source === 'embedded' ? '角色卡工作副本' : offDraft.source) : '绑定世界书文件') + '（DSHT 按需读盘，下轮筛选即生效）。仅改标题 / 关键词 / 正文，不提供删除。'),
            h('input', { key: 'title', className: 'dsh-local-input', style: { width: '100%', marginBottom: 6 }, placeholder: '标题', autoFocus: true, value: offDraft.title || '', onChange: e => setOffDraft({ ...offDraft, title: e.target.value }) }),
            h('input', { key: 'keys', className: 'dsh-local-input', style: { width: '100%', marginBottom: 6 }, placeholder: '关键词（空格分隔）', value: offDraft.keys || '', onChange: e => setOffDraft({ ...offDraft, keys: e.target.value }) }),
            h('textarea', { key: 'content', className: 'dsh-local-input', style: { width: '100%', minHeight: 120 }, placeholder: '条目正文', value: offDraft.content || '', onChange: e => setOffDraft({ ...offDraft, content: e.target.value }) })
          ) : null,
          h('h3', null, '官方世界书（卡内嵌 + 外部绑定）— ' + officialAll.length + ' 条'),
          h('details', { className: 'dsh-local-help', style: { marginBottom: 6 } },
            h('summary', { style: { cursor: 'pointer' } }, '标签说明（点击展开）'),
            h('ul', { style: { margin: '6px 0 0', paddingLeft: 18, fontSize: 11.5, lineHeight: 1.75 } },
              h('li', null, '内嵌：来自角色卡自带的世界书；外部·文件名：来自外部绑定的世界书文件。'),
              h('li', null, '📌在上下文：最新一轮真实模型请求里出现过（含工具补查读入；冷却/未命中条目可能因历史快照残留仍在上下文）。'),
              h('li', null, '常驻：每轮固定注入（不看关键词）；停用：不参与挑选。'),
              h('li', null, '淘汰原因：冷却中 / 关键词未命中 / LLM筛选未保留 = 这一轮为什么没进（同快照页）。'),
              h('li', null, '勾选 = ⚡强制注入下一次回复：跳过筛选直接进快照，但同样守 10 轮冷却。'),
              h('li', null, '界面版本 v0.7.17ar · 若显示旧版（排序/下拉框与桌面端不一致），请硬刷新（Ctrl+F5）后重试。')
            )
          ),
          renderToolbar('official'),
          !data?.dataRoot ? h('p', { className: 'dsh-local-warning' }, '未能定位 DSH 用户数据目录（dataRoot 推导失败），官方条目不可读。') : null,
          officialWithState.length === 0 ? h('p', { className: 'dsh-local-help' }, '无匹配条目。' + (q ? ' 换关键词试试。' : '')) :
          h('div', null, countBar(sortList(officialWithState.filter(e => matchTag(filterTags, { embedded: e.source === 'embedded', external: e.source && String(e.source).startsWith('external:'), inctx: ctxPresent.has(e.ref), constant: !!e.constant, disabled: e.enabled === false, sel: selectionSet.has(e.ref), pred: predictHit(e.keys, predictSource) }, intersect))).length, officialWithState.length), sortList(officialWithState.filter(e => matchTag(filterTags, { embedded: e.source === 'embedded', external: e.source && String(e.source).startsWith('external:'), inctx: ctxPresent.has(e.ref), recalled: !!e.inContext, constant: !!e.constant, disabled: e.enabled === false, sel: selectionSet.has(e.ref), pred: predictHit(e.keys, predictSource) }, intersect))).map((e, i) => { const src = sourceLabel(e.source); const selNow = selectionSet.has(e.ref); return h('div', { key: e.ref || i, className: 'dsh-local-entry', 'data-ref': String(e.ref || ''), style: { border: '1px solid #333', borderRadius: 6, padding: '6px 8px', marginBottom: 6 }, onContextMenu: (ev) => { ev.preventDefault(); setCtxMenu({ x: ev.clientX, y: ev.clientY, ref: e.ref, source: e.source, title: e.title, keys: e.keys || [], content: String(e.content || ''), enabled: e.enabled !== false }) }, onMouseDown: (ev) => { if (ev.button === 2) { ev.preventDefault(); setCtxMenu({ x: ev.clientX, y: ev.clientY, ref: e.ref, source: e.source, title: e.title, keys: e.keys || [], content: String(e.content || ''), enabled: e.enabled !== false }) } } },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
              h('input', { type: 'checkbox', checked: selNow, title: '强制注入下一次回复', onChange: () => toggleSelection(e.ref) }),
              (selNow ? h('span', { className: 'na-badge na-b-force' }, '⚡强制注入') : null),
              h('b', null, e.title || e.ref),
              h('span', { className: 'na-badge na-b-' + src.cls, title: src.full }, src.label),
              (e.enabled === false ? h('span', { className: 'na-badge na-b-off' }, '停用') : null),
              (ctxPresent.has(e.ref) ? h('span', { className: 'na-badge na-b-ctx', title: '出现在最新一轮模型请求上下文（含工具补查）' }, '📌在上下文') : null),
              (e.keys && e.keys.length ? predictHit(e.keys, predictSource) ? h('span', { className: 'na-badge na-b-pred', title: '预测：输入框文本 + 上一段 AI 输出命中关键词，提交后将被自动召回' }, '预测关键词命中') : null : null),
              e.reason ? h('span', { className: 'na-badge na-b-warn', title: e.reasonFull || '' }, e.reason) : null,
              (e.constant ? h('span', { className: 'na-badge na-b-constant' }, '常驻') : null),
            ),
            (e.keys && e.keys.length ? h('p', { className: 'dsh-local-help', style: { marginTop: 2 } }, '关键词: ' + e.keys.join('、') + ' ') : h('p', { className: 'dsh-local-help', style: { marginTop: 2 } }, '无关键词（只能靠强制注入直通，不会被自动召回） ')),
            (() => {
              const body = String(e.content || '')
              const open = expandedRefs.has(e.ref)
              const shown = open ? body : body.slice(0, 160)
              return h('div', null,
                body ? h('p', { style: { margin: '2px 0 0', fontSize: 12, whiteSpace: 'pre-wrap' } }, shown + (body.length > 160 && !open ? '…' : '') + (body.length > 160 ? ' ' : '')) : h('p', { className: 'dsh-local-help', style: { margin: '2px 0 0' } }, '（条目无正文）'),
                body.length > 160 ? h('button', { className: 'dsh-local-btn', style: { marginTop: 2 }, onClick: () => { const s = new Set(expandedRefs); if (open) s.delete(e.ref); else s.add(e.ref); setExpandedRefs(s) } }, open ? '收起' : '展开全文') : null
              )
            })()
          ) }))
        ) : null,

          ctxMenu ? ReactDOM.createPortal(h('div', { className: 'na-ctx-menu', onMouseDown: e => e.stopPropagation(), onClick: e => e.stopPropagation(), style: { position: 'fixed', left: Math.min(ctxMenu.x, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 150), top: Math.min(ctxMenu.y, (typeof window !== 'undefined' ? window.innerHeight : 800) - 90), zIndex: 2147483000, background: '#23272f', border: '1px solid #555', borderRadius: 6, boxShadow: '0 4px 16px rgba(0,0,0,.5)', padding: 4, minWidth: 132 } },
            h('button', { className: 'dsh-local-btn', style: { display: 'block', width: '100%', textAlign: 'left', marginBottom: 2 }, onClick: () => { setOffDraft({ ref: ctxMenu.ref, source: ctxMenu.source, title: ctxMenu.title, keys: (ctxMenu.keys || []).join(' '), content: ctxMenu.content }); setCtxMenu(null) } }, '✏️ 编辑'),
            h('button', { className: 'dsh-local-btn', style: { display: 'block', width: '100%', textAlign: 'left' }, onClick: async () => { setCtxMenu(null); await call('worldbook/entry', { action: 'toggle', entryId: ctxMenu.ref, source: ctxMenu.source }); load() } }, ctxMenu.enabled ? '⏸ 停用' : '▶ 启用')
          ), document.body) : null,
        // ── 页签：临时条目 ──
        tab === 'temporary' ? h('section', { className: 'dsh-local-section' },
          // ── v0.9.16 支线系统 ──
          h('div', { className: 'dsh-local-entry', style: { border: '1px solid #333', borderRadius: 8, padding: '8px 10px', marginBottom: 8 } },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
              h('b', null, '支线系统'),
              branchInfo?.familyId ? h('span', { className: 'na-badge na-b-ctx' }, branchInfo.isRoot ? '主线（族根）' : '支线成员') : h('span', { className: 'dsh-local-help', style: { fontSize: 11 } }, '本会话还没有族谱'),
              h('button', { className: 'dsh-local-btn', disabled: branchBusy, onClick: () => { setBranchNameDraft(''); setBranchNameOpen(true) }, title: '完整复制当前会话为新支线（复用官方分叉链路，新 chatId/sessionId）；族内共享已知情报，各成员 LTM 以【支线】临时条目互相注入' }, branchBusy ? '创建中…' : '创建支线（复制本会话）'),
              branchInfo?.familyId ? h('button', {
                className: 'dsh-local-btn', disabled: branchBusy,
                title: '不等后台结算，立即把族内其他成员的 LTM 与已知情报同步为本会话的【支线】临时条目（去重，重复点安全）',
                onClick: async () => {
                  setBranchBusy(true)
                  try {
                    const r = await api('branch/sync', { sessionId: effectiveSid })
                    if (r.ok) { flashTip(r.synced > 0 ? '✓ 已同步 ' + r.synced + ' 条支线条目（变更数）' : '✓ 支线条目已是最新'); void load() }
                    else flashTip(r.error || '同步失败')
                  } catch (err) { flashTip('同步失败：' + String(err?.message || err)) }
                  finally { setBranchBusy(false) }
                }
              }, '立即导入支线条目') : null,
              branchInfo?.familyId && (branchInfo.members || []).length > 0 ? h('select', {
                className: 'dsh-local-input', style: { width: 200, fontSize: 12 }, value: mergePick, onChange: e => setMergePick(e.target.value),
                title: '把另一个族的全部成员与已知情报并入本族（源族文件删除，源族根变为本族支线）'
              },
                h('option', { value: '' }, '选择要并入本族的族…'),
                (families || []).filter(f => f.familyId !== branchInfo.familyId)
                  .map(f => h('option', { key: f.familyId, value: f.familyId }, familyOptionLabel(f)))
              ) : null,
              branchInfo?.familyId && (families || []).some(f => f.familyId !== branchInfo.familyId) ? h('button', {
                className: 'dsh-local-btn', disabled: branchBusy || !mergePick,
                title: '合并族：源族成员全部并入本族，known_facts 合并（只增不减），源族文件删除',
                onClick: () => mergeFamily(mergePick)
              }, '并入本族') : null
            ),
            // 无族会话：在本会话选择要加入的族（绑定支线关联，无需 fork 关系）
            !branchInfo?.familyId && (families || []).length > 0
              ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 6 } },
                h('select', {
                  className: 'dsh-local-input', style: { width: 240, fontSize: 12 }, value: joinPick, onChange: e => setJoinPick(e.target.value),
                  title: '把本会话作为支线加入所选族（共享已知情报，LTM 互注；之后可解除关联）'
                },
                  h('option', { value: '' }, '选择要加入的族…'),
                  (families || []).map(f => h('option', { key: f.familyId, value: f.familyId }, familyOptionLabel(f)))
                ),
                h('button', { className: 'dsh-local-btn', disabled: branchBusy || !joinPick, onClick: () => joinFamily(joinPick) }, '加入所选族')
              )
              : null,
            branchInfo?.familyId && (branchInfo.members || []).length > 0
              ? h('div', { style: { margin: '6px 0 0' } },
                h('b', { style: { fontSize: 12, display: 'block', marginBottom: 2 } }, '族谱成员（已删除会话自动剔除）：'),
                ...branchInfo.members.map(m => h('div', { key: m.sessionId, style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', padding: '2px 0', fontSize: 12 } },
                  h('span', { className: 'na-badge ' + (m.isRoot ? 'na-b-out' : 'na-b-ctx') }, m.isRoot ? '主线' : '支线'),
                  editingSid === m.sessionId
                    ? h(React.Fragment, null,
                      h('input', { className: 'dsh-local-input', style: { width: 180, fontSize: 12 }, value: editingLabel, autoFocus: true, onChange: e => setEditingLabel(e.target.value), onKeyDown: e => { if (e.key === 'Enter') renameBranch(m.sessionId); if (e.key === 'Escape') setEditingSid(null) } }),
                      h('button', { className: 'dsh-local-btn', onClick: () => renameBranch(m.sessionId) }, '保存'),
                      h('button', { className: 'dsh-local-btn', onClick: () => setEditingSid(null) }, '取消')
                    )
                    : h(React.Fragment, null,
                      h('b', null, m.label || (m.isRoot ? '主线' : '支线')),
                      h('button', { className: 'dsh-local-btn', style: { fontSize: 11, padding: '1px 6px' }, title: '修改支线系统内部别名（不改会话名；各成员条目的别名标记会随后同步）', onClick: () => startRename(m) }, '改别名'),
                      h('span', { className: 'dsh-local-help', style: { fontSize: 11 } }, '会话名：' + memberTitle(m)),
                      !m.isRoot && m.registered ? h('button', {
                        className: 'dsh-local-btn', style: { fontSize: 11, padding: '1px 6px' },
                        title: '把该支线移出本族（保留其全部数据与本地情报快照，双向清理【支线】条目；可重新加入）',
                        onClick: () => unbindBranch(m)
                      }, '解除关联') : null
                    )
                )),
                h('p', { className: 'dsh-local-help', style: { margin: '4px 0 0', fontSize: 11.5 } },
                  '已知情报族内实时共享；各成员的 LTM 会以【支线】临时条目注入其他成员（根节点启用、非根自动停用，关键词含【<--别名-->】标记）；会话绑定随支线继承，临时条目不继承')
              )
              : null
          ),
          branchNameOpen ? h('div', {
            style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }
          },
            h('div', { className: 'dsh-local-section', style: { width: 360, maxWidth: '90vw', padding: 16 } },
              h('b', null, '创建支线会话'),
              h('p', { className: 'dsh-local-help', style: { margin: '4px 0 8px', fontSize: 12 } }, '输入支线别名（同时作为会话名）'),
              h('input', {
                className: 'dsh-local-input', style: { width: '100%', marginBottom: 10 }, autoFocus: true,
                placeholder: '如：异种族风俗娘线', value: branchNameDraft,
                onChange: e => setBranchNameDraft(e.target.value),
                onKeyDown: e => {
                  if (e.key === 'Enter') { const n = branchNameDraft.trim(); if (n) { setBranchNameOpen(false); createSideSession(n) } }
                  if (e.key === 'Escape') setBranchNameOpen(false)
                }
              }),
              h('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end' } },
                h('button', { className: 'dsh-local-btn', onClick: () => setBranchNameOpen(false) }, '取消'),
                h('button', {
                  className: 'dsh-local-btn',
                  disabled: branchBusy || !branchNameDraft.trim(),
                  onClick: () => { const n = branchNameDraft.trim(); if (n) { setBranchNameOpen(false); createSideSession(n) } }
                }, branchBusy ? '创建中…' : '创建')
              )
            )
          ) : null,
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
            h('h3', { style: { margin: 0 } }, '会话临时世界书条目 — ' + entries.length + ' 条'),
            h('button', {
              className: 'dsh-local-btn',
              title: '把临时条目导出为 SillyTavern 世界书 JSON 文件（可导入 DSHT 独立世界书库或原版 ST）。受当前搜索词/标签筛选影响，只导出列表可见条目',
              onClick: () => {
                const n = exportTempWorldbook({ ...book, entries: visibleTemp }, effectiveSid)
                flashTip(n > 0 ? '✓ 已导出 ' + n + ' 条临时条目' + (visibleTemp.length < entries.length ? '（当前筛选 ' + visibleTemp.length + '/' + entries.length + '）' : '') : '没有可导出的条目')
              }
            }, '导出世界书'),
            h('button', {
              className: 'dsh-local-btn',
              title: '在上方展开新增条目表单',
              onClick: () => setDraft({})
            }, '新增条目'),
            h('button', {
              className: 'dsh-local-btn',
              title: '删除当前搜索词/标签筛选下的所有可见条目（无筛选时=全部条目，谨慎！）',
              onClick: async () => {
                if (!visibleTemp.length) { flashTip('当前筛选下没有可清空的条目'); return }
                const scope = visibleTemp.length < entries.length ? '当前筛选的 ' + visibleTemp.length + ' 条（共 ' + entries.length + ' 条）' : '全部 ' + entries.length + ' 条'
                if (!window.confirm('确定删除' + scope + '临时条目？此操作不可恢复（支线/锚点条目可在下次同步/结算时重新生成）。')) return
                try {
                  const r = await api('worldbook/entries-clear', { sessionId: effectiveSid, ids: visibleTemp.map(e => e.id) })
                  if (r.ok) { flashTip('✓ 已清空 ' + r.removed + ' 条临时条目'); void load() }
                  else flashTip(r.error || '清空失败')
                } catch (err) { flashTip('清空失败：' + String(err?.message || err)) }
              }
            }, '清空条目')
          ),
          // [v0.9.5] 新增/编辑改为弹层（ESC / 点遮罩关闭），不再占据页面流
          draft ? h(EditModal, {
            title: draft?.id ? '编辑条目：' + (draft.title || '(未命名)') : '新增条目',
            onClose: () => setDraft(null),
            footer: [
              h('button', { key: 'cancel', className: 'dsh-local-btn', onClick: () => setDraft(null) }, '取消'),
              h('button', { key: 'save', className: 'dsh-local-btn na-tab-active', onClick: async () => {
                if (!draft?.title && !draft?.content) return
                await call('worldbook/entry', {
                  sessionId: effectiveSid,
                  action: draft?.id ? 'update' : 'add',
                  entry: { id: draft?.id, title: draft.title || '', keys: (draft.keys || '').split(/[\s,，、]+/).filter(Boolean), content: draft.content || '', enabled: true }
                })
                setDraft(null)
              } }, draft?.id ? '保存修改' : '新增条目')
            ]
          },
            h('input', { key: 'title', className: 'dsh-local-input', style: { width: '100%', marginBottom: 6 }, placeholder: '标题', autoFocus: true, value: draft?.title || '', onChange: e => setDraft({ ...(draft || {}), title: e.target.value }) }),
            h('input', { key: 'keys', className: 'dsh-local-input', style: { width: '100%', marginBottom: 6 }, placeholder: '关键词（空格分隔；留空则只能靠强制注入直通，不会被自动召回）', value: draft?.keys || '', onChange: e => setDraft({ ...(draft || {}), keys: e.target.value }) }),
            h('textarea', { key: 'content', className: 'dsh-local-input', style: { width: '100%', minHeight: 120 }, placeholder: '条目正文', value: draft?.content || '', onChange: e => setDraft({ ...(draft || {}), content: e.target.value }) })
          ) : null,
          h('details', { className: 'dsh-local-help', style: { marginBottom: 6 } },
            h('summary', { style: { cursor: 'pointer' } }, '标签说明（点击展开）'),
            h('ul', { style: { margin: '6px 0 0', paddingLeft: 18, fontSize: 11.5, lineHeight: 1.75 } },
              h('li', null, '锚点：由叙事锚点自动流入的条目；人工：手动创建 / 编辑的条目。'),
              h('li', null, '⚡强制注入：勾选后下一次回复强制进快照（豁免筛选，但守 10 轮冷却；冷却中强制注入也不绕过）。'),
              h('li', null, '✅在快照：已进入最近一轮动态世界书快照（审计推断）。'),
              h('li', null, '在上下文：出现在最新一轮真实模型请求文本中（含工具补查结果；在快照 ≠ 一定仍在上下文，压缩后旧快照会退出）。'),
              h('li', null, '⏳冷却中：最近注入过，正在 10 轮冷却，本轮不参与挑选（刚注入的条目从下一轮筛选起进入冷却）。'),
              h('li', null, '已停用：不参与召回与注入。')
            )
          ),
          renderToolbar('temporary'),
          entries.length === 0 ? h('p', { className: 'dsh-local-help' }, '暂无条目。点击「新增条目」创建，或开启自动流入后由锚点数据生成。') :
          h('div', null, countBar(visibleTemp.length, tempFiltered.length), visibleTemp.map((e) => h('div', { key: e.id, className: 'dsh-local-entry', style: { border: '1px solid #333', borderRadius: 6, padding: '6px 8px', marginBottom: 6 } },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
              h('input', { type: 'checkbox', checked: selectionSet.has('session-wb:' + e.id), title: '强制注入下一次回复（force 激活：过筛选 + 守冷却）', onChange: () => toggleSelection('session-wb:' + e.id) }),
              h('b', null, e.title || '(未命名)'),
              h('span', { className: 'na-badge ' + (e.source === 'anchor' ? 'na-b-out' : e.source === 'sideline' ? 'na-b-ctx' : 'na-b-ok') }, e.source === 'anchor' ? '锚点' : e.source === 'sideline' ? '支线' : '人工'),
              (e.enabled === false ? h('span', { className: 'na-badge na-b-off' }, '已停用') : null),
              (selectionSet.has('session-wb:' + e.id) ? h('span', { className: 'na-badge na-b-force' }, '⚡强制注入') : null),
              (isCooling('session-wb:' + e.id) ? h('span', { className: 'na-badge na-b-off', title: '最近注入过，10 轮冷却中；强制注入也不绕过' }, '⏳冷却中') : null),
              (e.inContext ? h('span', { className: 'na-badge na-b-in', title: '已进入最近一轮动态世界书快照（审计）' }, '✅在快照') : null),
              (ctxPresent.has('session-wb:' + e.id) ? h('span', { className: 'na-badge na-b-ctx', title: '出现在最新一轮模型请求上下文（含工具补查）' }, '📌在上下文') : null),
              (e.keys && e.keys.length ? predictHit(e.keys, predictSource) ? h('span', { className: 'na-badge na-b-pred', title: '预测：输入框文本 + 上一段 AI 输出命中关键词，提交后将被自动召回' }, '预测关键词命中') : null : null),
              h('button', { className: 'dsh-local-btn', onClick: () => call('worldbook/entry', { sessionId: effectiveSid, action: 'toggle', entryId: e.id }) }, e.enabled === false ? '启用' : '停用'),
              e.source === 'sideline' ? null : h('button', { className: 'dsh-local-btn', onClick: () => setDraft({ ...e, keys: (e.keys || []).join(' ') }) }, '编辑'),
              h('button', { className: 'dsh-local-btn', onClick: () => call('worldbook/entry', { sessionId: effectiveSid, action: 'delete', entryId: e.id }) }, '删除')
            ),
            (e.keys && e.keys.length ? h('p', { className: 'dsh-local-help', style: { marginTop: 2 } }, '关键词: ' + e.keys.join('、') + ' ') : h('p', { className: 'dsh-local-help', style: { marginTop: 2 } }, '无关键词（只能靠强制注入直通，不会被自动召回） ')),
            h('p', { style: { margin: '2px 0 0', fontSize: 12, whiteSpace: 'pre-wrap' } }, String(e.content || '').slice(0, 200) + (String(e.content || '').length > 200 ? '…' : ''))
          )))
        ) : null,

        // ── 页签：会话世界书 ──
        tab === 'sessionwb' ? h('section', { className: 'dsh-local-section' },
          h('details', { className: 'dsh-local-help', style: { marginBottom: 6 } },
            h('summary', { style: { cursor: 'pointer' } }, '这是什么？（点击展开）'),
            h('p', { style: { margin: '6px 0 2px', fontSize: 11.5 } }, '把世界书绑定到当前会话：角色卡内嵌世界书（角色卡）或独立世界书文件（独立）。绑定后其条目并入 DSHT 原生世界书召回（与临时条目同一合并点），参与关键词激活 / 常驻 / 10 轮冷却。'),
            h('p', { style: { margin: '2px 0', fontSize: 11.5 } }, '「组合」是跨会话复用的绑定集合：先把常用世界书存成组合，之后在任何会话一键应用。'),
            h('p', { style: { margin: '2px 0', fontSize: 11.5 } }, '「全局自动绑定」：在下方可用列表点「设为全局」后，新会话/分支会话会自动绑定该世界书；某会话解绑仅解除该会话，全局清单不变。')
          ),
          h('details', { className: 'dsh-local-help', style: { marginBottom: 6 } },
            h('summary', { style: { cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: 'var(--na-text)' } }, '会话世界书绑定 — ' + (data?.bound?.books?.length || 0) + ' 本 / ' + (data?.bound?.entryCount || 0) + ' 条并入'),
            h('div', null,
          h('b', { style: { display: 'block', margin: '2px 0 6px' } }, '已绑定：'),
          h('input', { className: 'dsh-local-input', style: { width: '100%', marginTop: 2 }, placeholder: '检索已绑定：名称 / 路径（本列表内过滤）', value: boundQ, onChange: e => setBoundQ(e.target.value) }),
          bindChips(boundT, setBoundT, [['embedded', '角色卡'], ['external', '独立'], ['global', '全局'], ['unavail', '不可用']], boundInv, setBoundInv),
          (!data?.bound?.books || data.bound.books.length === 0) ? h('p', { className: 'dsh-local-help' }, '尚未绑定任何世界书（含全局自动绑定）。从下方可用列表选择绑定，或应用一个组合。') :
          (() => {
            const q = String(boundQ || '').trim().toLocaleLowerCase()
            const all = data.bound.books
            const list = all.map((b, i) => ({ b, i })).filter(({ b }) => {
              const hay = ((b.name || '') + ' ' + (b.path || '') + ' ' + (b.cardPath || '')).toLocaleLowerCase()
              if (q && !hay.includes(q)) return false
              return matchTag(boundT, {
                embedded: b.kind === 'embedded', external: b.kind !== 'embedded',
                global: globalSet.has(JSON.stringify({ kind: b.kind, cardPath: b.cardPath, path: b.path })),
                unavail: b.available === false
              }, false, boundInv)
            })
            if (list.length === 0) return h('p', { className: 'dsh-local-help' }, '无匹配世界书。' + (q ? ' 换关键词试试。' : ''))
            return h('div', null,
              h('p', { style: { fontSize: 11, color: 'var(--na-dim)', margin: '4px 2px 2px' } }, '共 ' + all.length + ' 本' + (list.length !== all.length ? ' · 筛选 ' + list.length + ' 本' : '')),
              list.map(({ b, i }) => h('div', { key: i, className: 'dsh-local-entry', style: { border: '1px solid #333', borderRadius: 6, padding: '5px 8px', marginBottom: 5, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
                h('button', { className: 'dsh-local-btn', title: '解绑此世界书（全局自动绑定的世界书解绑后仅本会话解除，新会话仍自动绑定）', onClick: () => unbindBook(b) }, '解绑'),
                h('span', { className: 'na-badge ' + (b.kind === 'embedded' ? 'na-b-ok' : 'na-b-ext') }, b.kind === 'embedded' ? '角色卡' : '独立'),
                h('b', null, b.name || '(未命名)'),
                globalSet.has(JSON.stringify({ kind: b.kind, cardPath: b.cardPath, path: b.path })) ? h('span', { className: 'na-badge na-b-ok' }, '全局') : null,
                b.available === false
                  ? h('span', { className: 'na-badge na-b-off', title: b.error || '' }, '不可用')
                  : h('span', { className: 'na-badge na-b-in' }, b.entryCount + ' 条')
              )))
          })(),
          h('b', { style: { display: 'block', margin: '16px 0 6px', paddingTop: 10, borderTop: '1px solid #333' } }, '世界书组合：'),
          h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 4 } },
            h('input', { className: 'dsh-local-input', style: { flex: '1 1 140px', minWidth: 100 }, placeholder: '新组合名（先勾选下方世界书）', value: comboDraft.name || '', onChange: e => setComboDraft({ ...comboDraft, name: e.target.value }) }),
            h('button', { className: 'dsh-local-btn', onClick: () => saveCombo() }, '保存为组合')
          ),
          combos.length === 0 ? h('p', { className: 'dsh-local-help', style: { margin: '2px 0' } }, '暂无组合。勾选下方可用世界书 → 输入组合名 → 保存为组合。') :
          h('div', null,
            h('input', { className: 'dsh-local-input', style: { width: '100%', marginTop: 2 }, placeholder: '检索组合：名称 / 所含世界书（本列表内过滤）', value: comboQ, onChange: e => setComboQ(e.target.value) }),
            bindChips(comboT, setComboT, [['embedded', '含角色卡书'], ['external', '含独立书']], comboInv, setComboInv),
            (() => {
              const q = String(comboQ || '').trim().toLocaleLowerCase()
              const filtered = combos.filter(c => {
                const hay = ((c.name || '') + ' ' + (c.books || []).map(x => (x.kind === 'embedded' ? (x.cardPath || '') : (x.path || ''))).join(' ')).toLocaleLowerCase()
                if (q && !hay.includes(q)) return false
                return matchTag(comboT, {
                  embedded: (c.books || []).some(x => x.kind === 'embedded'),
                  external: (c.books || []).some(x => x.kind !== 'embedded')
                }, false, comboInv)
              })
              if (filtered.length === 0) return h('p', { className: 'dsh-local-help', style: { margin: '2px 0' } }, '无匹配组合。' + (q ? ' 换关键词试试。' : ''))
              return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 } },
                h('p', { style: { fontSize: 11, color: 'var(--na-dim)', margin: '0 2px' } }, '共 ' + combos.length + ' 个' + (filtered.length !== combos.length ? ' · 筛选 ' + filtered.length + ' 个' : '')),
                filtered.map(c => h('div', { key: c.id, className: 'dsh-local-entry', style: { border: '1px solid #333', borderRadius: 8, padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
            h('b', { style: { minWidth: 70 } }, c.name),
            h('span', { className: 'na-badge na-b-ext' }, c.books.length + ' 本'),
            h('details', { style: { flex: '1 1 200px', minWidth: 150 } },
              h('summary', { style: { cursor: 'pointer', fontSize: 11.5, color: 'var(--na-dim)' } }, '世界书列表（点击展开）'),
              h('div', { style: { marginTop: 5, display: 'flex', flexDirection: 'column', gap: 3 } },
                c.books.map((x, j) => h('div', { key: j, style: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5 } },
                  h('span', { className: 'na-badge ' + (x.kind === 'embedded' ? 'na-b-ok' : 'na-b-ext') }, x.kind === 'embedded' ? '角色卡' : '独立'),
                  String(x.kind === 'embedded' ? (x.cardPath || '') : (x.path || '')).replace(/^.*(cards|worldbooks)[\\/]/, ''),
                  h('button', { className: 'dsh-local-btn', style: { padding: '0 6px', fontSize: 11 }, title: '从组合中移除这本世界书', onClick: () => removeComboBook(c.id, j) }, '移除')
                ))
              )
            ),
            h('div', { style: { marginLeft: 'auto', display: 'flex', gap: 6 } },
              h('button', { className: 'dsh-local-btn', title: '把当前勾选的世界书加入此组合（不去重冲突项）', onClick: () => addPickedToCombo(c.id) }, '＋ 加入世界书'),
              h('button', { className: 'dsh-local-btn', title: '把组合中的世界书并入当前绑定（不替换已有绑定）', onClick: () => applyCombo(c.id, 'merge') }, '＋ 添加'),
              h('button', { className: 'dsh-local-btn', title: '用组合替换当前全部绑定', onClick: () => applyCombo(c.id, 'replace') }, '应用'),
              h('button', { className: 'dsh-local-btn', title: '删除此组合', onClick: () => delCombo(c.id) }, '删除')
            )
          )))})()),
          h('b', { style: { display: 'block', margin: '16px 0 6px', paddingTop: 10, borderTop: '1px solid #333' } }, '可用世界书（勾选 → 绑定到本会话 / 存为组合）：'),
          h('p', { className: 'dsh-local-help', style: { margin: '2px 0' } }, '当前会话自动包含角色卡自带世界书；以下为可额外绑定的来源。'),
          h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 4, position: 'relative' } },
            h('button', { className: 'dsh-local-btn', onClick: () => bindSelected() }, '绑定所选 → 本会话')
          ),
          h('div', { style: { marginTop: 4 } },
            libStandalone.length === 0 && libEmbedded.length === 0 ? h('p', { className: 'dsh-local-help' }, '暂无可绑定世界书（无独立世界书文件，且没有其它带世界书的角色卡）。') :
            (() => {
              const q = String(availQ || '').trim().toLocaleLowerCase()
              const all = libAll
              const list = all.filter(item => {
                const hay = ((item.name || '') + ' ' + (item.kind === 'embedded' ? (item.cardPath || '') : (item.path || ''))).toLocaleLowerCase()
                if (q && !hay.includes(q)) return false
                const key2 = JSON.stringify({ kind: item.kind, cardPath: item.cardPath, path: item.path })
                return matchTag(availT, {
                  embedded: item.kind === 'embedded', external: item.kind !== 'embedded',
                  bound: boundSet.has(key2), global: globalSet.has(key2)
                }, false, availInv)
              })
              if (list.length === 0) return h('p', { className: 'dsh-local-help' }, '无匹配世界书。' + (q ? ' 换关键词试试。' : ''))
              return h('div', null,
                h('input', { className: 'dsh-local-input', style: { width: '100%', marginTop: 2 }, placeholder: '检索可用世界书：名称 / 路径（本列表内过滤）', value: availQ, onChange: e => setAvailQ(e.target.value) }),
                bindChips(availT, setAvailT, [['embedded', '角色卡'], ['external', '独立'], ['bound', '已绑定'], ['global', '全局']], availInv, setAvailInv),
                h('p', { style: { fontSize: 11, color: 'var(--na-dim)', margin: '4px 2px 2px' } }, '共 ' + all.length + ' 本' + (list.length !== all.length ? ' · 筛选 ' + list.length + ' 本' : '')),
                list.map(item => {
              const key = JSON.stringify({ kind: item.kind, cardPath: item.cardPath, path: item.path })
              const picked = pickedBooks.has(key)
              const isBound = boundSet.has(key)
              const isGlobal = globalSet.has(key)
              return h('div', { key, className: 'dsh-local-entry', style: { border: '1px solid #333', borderRadius: 6, padding: '5px 8px', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
                h('input', { type: 'checkbox', checked: picked, onChange: () => togglePick(key) }),
                h('span', { className: 'na-badge ' + (item.kind === 'embedded' ? 'na-b-ok' : 'na-b-ext') }, item.kind === 'embedded' ? '角色卡' : '独立'),
                h('b', null, item.name || '(未命名)'),
                h('span', { className: 'dsh-local-help', style: { fontSize: 11 } }, (item.kind === 'embedded' ? item.cardPath : item.path) + ' · ' + item.entryCount + ' 条'),
                isBound ? h('span', { className: 'na-badge na-b-in' }, '已绑定') : null,
                isGlobal ? h('span', { className: 'na-badge na-b-ok', title: '全局自动绑定：新会话/分支会话自动跟随' }, '全局') : null,
                h('button', {
                  className: 'dsh-local-btn',
                  title: isGlobal ? '取消全局自动绑定' : '设为全局自动绑定：之后的新会话/分支会话自动绑定此世界书',
                  onClick: () => toggleGlobalBind(item)
                }, isGlobal ? '取消全局' : '设为全局')
              )
            }))
            })()
          )
          )),
        ) : null,

        // ── 会话世界书条目列表（v0.7.19b：绑定世界书条目，像官方世界书列表）──
        (() => {
          if (tab !== 'sessionwb') return null
          const boundBooks = data?.bound?.books || []
          const be = (data?.bound?.entries || []).map(e => {
            const bk = boundBooks[e.boundWorldbookIndex] || {}
            return { ...e, sourceBook: bk.name || '', sourceBookPath: bk.path || bk.cardPath || '' }
          })
          const sq = String(sbQuery || '').trim().toLocaleLowerCase()
          const sbFiltered = be.filter(e => {
            if (sbBookFilter && String(e.boundWorldbookIndex) !== sbBookFilter) return false
            const hay = (e.title || '') + ' ' + (e.keys || []).join(' ') + ' ' + String(e.content || '')
            if (sq && !hay.toLocaleLowerCase().includes(sq)) return false
            return matchTag(sbFilterTags, {
              inctx: ctxPresent.has(e.ref),
              constant: e.constant === true,
              forced: selectionSet.has(e.ref) || forcedSet.has(e.ref),
              pred: predictHit(e.keys, predictSource),
              disabled: e.enabled === false
            }, sbIntersect, sbInvert)
          })
          return h('section', { className: 'dsh-local-section' },
            h('h3', null, '会话世界书条目 — ' + be.length + ' 条'),
            h('details', { className: 'dsh-local-help', style: { marginBottom: 6 } },
              h('summary', { style: { cursor: 'pointer' } }, '标签说明（点击展开）'),
              h('ul', { style: { margin: '6px 0 0', paddingLeft: 18, fontSize: 11.5, lineHeight: 1.75 } },
                h('li', null, '📌在上下文：出现在最新一轮真实模型请求文本（含工具补查）。'),
                h('li', null, '常驻：每轮固定注入（不看关键词）。'),
                h('li', null, '⚡强制注入：勾选后下一次回复跳过筛选直接进快照（守 10 轮冷却）；上一轮实际强制注入的也在此标记。'),
                h('li', null, '预测关键词命中：输入框文本 + 上一段 AI 输出命中关键词，提交后将被自动召回。'),
                h('li', null, '停用：不参与召回与注入。')
              )
            ),
            h('input', { className: 'dsh-local-input', style: { width: '100%', marginTop: 6 }, placeholder: '检索：标题 / 关键词 / 正文（本列表内过滤）', value: sbQuery, onChange: e => setSbQuery(e.target.value) }),
            h('div', { style: { marginTop: 7, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' } },
              h('button', { className: sbFilterTags.size === 0 ? 'dsh-local-btn na-tab-active' : 'dsh-local-btn', style: { padding: '2px 9px', fontSize: 11.5 }, title: '清空所有标签筛选', onClick: () => setSbFilterTags(new Set()) }, '全部'),
              [['inctx', '📌在上下文'], ['constant', '常驻'], ['forced', '⚡强制注入'], ['pred', '预测关键词命中'], ['disabled', '停用']].map(([v, label]) => {
                const active = sbFilterTags.has(v)
                return h('button', { key: v, className: active ? 'dsh-local-btn na-tab-active' : 'dsh-local-btn', style: { padding: '2px 9px', fontSize: 11.5 }, title: '互斥筛选：点选只看此类，点激活项取消', onClick: () => setSbFilterTags(active ? new Set() : new Set([v])) }, label)
              }),
              h('select', { className: 'dsh-local-input', style: { minHeight: 26, fontSize: 11.5, width: 'auto', marginLeft: 4 }, title: '按来源世界书筛选', value: sbBookFilter || '', onChange: e => setSbBookFilter(e.target.value) },
                h('option', { value: '' }, '按世界书: 全部'),
                boundBooks.map((b, i) => h('option', { key: i, value: String(i) }, '按世界书: ' + (b.name || b.path || b.cardPath || ('#' + i))))
              ),
              h('label', { style: { display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11.5, color: 'var(--na-dim)', whiteSpace: 'nowrap', cursor: 'pointer', marginLeft: 2 }, title: '勾选后多个标签需同时满足（AND）；不勾选为任一满足（OR）' },
                h('input', { type: 'checkbox', checked: sbIntersect, onChange: e => setSbIntersect(e.target.checked), style: { width: 13, height: 13, cursor: 'pointer', margin: 0 } }), '交集'),
              h('label', { style: { display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11.5, color: 'var(--na-dim)', whiteSpace: 'nowrap', cursor: 'pointer', marginLeft: 2 }, title: '勾选后显示不符合所选标签的条目（反选）' },
                h('input', { type: 'checkbox', checked: sbInvert, onChange: e => setSbInvert(e.target.checked), style: { width: 13, height: 13, cursor: 'pointer', margin: 0 } }), '反选')
            ),
            sbFiltered.length === 0 ? h('p', { className: 'dsh-local-help' }, '无匹配条目。' + (sbQuery ? ' 换关键词试试。' : '')) :
            h('div', null, h('p', { style: { fontSize: 11, color: 'var(--na-dim)', margin: '6px 2px 4px', whiteSpace: 'nowrap' } }, '共 ' + be.length + ' 条' + (sbFiltered.length !== be.length ? ' · 筛选 ' + sbFiltered.length + ' 条' : '')), sbFiltered.map((e, i) => h('div', { key: e.ref || i, className: 'dsh-local-entry', 'data-ref': e.ref, style: { border: '1px solid #333', borderRadius: 6, padding: '6px 8px', marginBottom: 6 } },
              h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
                h('input', { type: 'checkbox', checked: selectionSet.has(e.ref), title: '强制注入下一次回复（force 激活：过筛选 + 守冷却）', onChange: () => toggleSelection(e.ref) }),
                (selectionSet.has(e.ref) ? h('span', { className: 'na-badge na-b-force' }, '⚡强制注入') : null),
                h('b', null, e.title || e.ref),
                (e.sourceBook ? h('span', { className: 'na-badge na-b-' + (e.boundWorldbookIndex % 2 ? 'out' : 'const'), title: e.sourceBookPath || '' }, e.sourceBook) : null),
                (e.enabled === false ? h('span', { className: 'na-badge na-b-off' }, '停用') : null),
                (e.constant ? h('span', { className: 'na-badge na-b-constant' }, '常驻') : null),
                (ctxPresent.has(e.ref) ? h('span', { className: 'na-badge na-b-ctx', title: '出现在最新一轮模型请求上下文（含工具补查）' }, '📌在上下文') : null),
                (e.keys && e.keys.length && predictHit(e.keys, predictSource) ? h('span', { className: 'na-badge na-b-pred', title: '预测：输入框文本 + 上一段 AI 输出命中关键词，提交后将被自动召回' }, '预测关键词命中') : null)
              ),
              (e.keys && e.keys.length ? h('p', { className: 'dsh-local-help', style: { marginTop: 2 } }, '关键词: ' + e.keys.join('、') + ' ') : h('p', { className: 'dsh-local-help', style: { marginTop: 2 } }, '无关键词（只能靠强制注入直通，不会被自动召回） ')),
              (() => {
                const body = String(e.content || '')
                const open = expandedRefs.has(e.ref)
                const shown = open ? body : body.slice(0, 160)
                return h('div', null,
                  body ? h('p', { style: { margin: '2px 0 0', fontSize: 12, whiteSpace: 'pre-wrap' } }, shown + (body.length > 160 && !open ? '…' : '') + (body.length > 160 ? ' ' : '')) : h('p', { className: 'dsh-local-help', style: { margin: '2px 0 0' } }, '（条目无正文）'),
                  body.length > 160 ? h('button', { className: 'dsh-local-btn', style: { marginTop: 2 }, onClick: () => { const s2 = new Set(expandedRefs); if (open) s2.delete(e.ref); else s2.add(e.ref); setExpandedRefs(s2) } }, open ? '收起' : '展开全文') : null
                )
              })()
            ))))
        })(),

        error ? h('p', { className: 'dsh-local-warning' }, error) : null,
        !loaded ? h('p', { className: 'dsh-local-help' }, '加载中…') : null,
        h('p', { className: 'dsh-local-help', style: { marginTop: 8, fontSize: 11, opacity: 0.7 } }, '会话: ' + (effectiveSid || '(未绑定)') + (currentChatId ? ' (uiConversation)' : ' (scope)') + (data?.official?.card?.name ? ' · 卡: ' + data.official.card.name : '') + (uiErr ? ' · ' + uiErr : ''))
      )
    )
  }

  // ========== 官方 DSH-Tavern Plugin API v2 侧边栏组与面板注册 ==========
  if (ctx.tavernUi) {
    globalTavernUi = ctx.tavernUi
    try {
      if (typeof ctx.tavernUi.registerStartGroup === 'function') {
        ctx.tavernUi.registerStartGroup({
          title: '叙事锚定',
          tabs: ['narrative-anchor:status', 'narrative-anchor:worldbook', 'narrative-anchor:settings']
        })
      }
      if (typeof ctx.tavernUi.registerPanel === 'function') {
        ctx.tavernUi.registerPanel({
          id: 'narrative-anchor:status',
          title: '锚点状态',
          render: ({ gameId }) => h(NarrativeAnchorStatusTab, { sessionId: gameId, scope: { sessionId: gameId }, uiConversation: getUiConversation })
        })
        ctx.tavernUi.registerPanel({
          id: 'narrative-anchor:worldbook',
          title: '会话世界书',
          render: ({ gameId }) => h(NarrativeAnchorWorldbookTab, { sessionId: gameId, scope: { sessionId: gameId }, uiConversation: getUiConversation, sessions: ctx.sessions, ctx })
        })
        ctx.tavernUi.registerPanel({
          id: 'narrative-anchor:settings',
          title: '锚定设置',
          render: ({ gameId }) => h(NarrativeAnchorSettingsTab, { sessionId: gameId, scope: { sessionId: gameId }, uiConversation: getUiConversation })
        })
      }
    } catch (e) {
      console.warn('[dsh-tavern-narrative-anchor] tavernUi 侧边栏注册异常:', e)
    }
  }

  // ========== 注册侧边栏 tab（延迟到 betterSidebar 服务可用，模式同 tavern-plugin）==========
  const getUiConversation = () => ctx.get('uiConversation') || ctx.get('conversation')
  ctx.effect(() => ctx.betterSidebar.registerTab({
    id: 'narrative-anchor:settings',
    title: '叙事锚定设置',
    order: 9,
    single: true,
    createTab: () => ({ tab: { id: 'narrative-anchor:settings', type: 'narrative-anchor:settings', title: '叙事锚定设置' }, patch: { panelOpen: true } }),
    component: props => h(NarrativeAnchorSettingsTab, { sessionId: props.scope?.sessionId, scope: props.scope, uiConversation: getUiConversation })
  }), 'narrative-anchor: settings tab')

  ctx.effect(() => ctx.betterSidebar.registerTab({
    id: 'narrative-anchor:status',
    title: '叙事锚定状态',
    order: 8,
    single: true,
    createTab: () => ({ tab: { id: 'narrative-anchor:status', type: 'narrative-anchor:status', title: '叙事锚定状态' }, patch: { panelOpen: true } }),
    component: props => h(NarrativeAnchorStatusTab, { sessionId: props.scope?.sessionId, scope: props.scope, uiConversation: getUiConversation })
  }), 'narrative-anchor: status tab')

  ctx.effect(() => ctx.betterSidebar.registerTab({
    id: 'narrative-anchor:worldbook',
    title: '会话世界书',
    order: 7,
    single: true,
    createTab: () => ({ tab: { id: 'narrative-anchor:worldbook', type: 'narrative-anchor:worldbook', title: '会话世界书' }, patch: { panelOpen: true } }),
    component: props => h(NarrativeAnchorWorldbookTab, { sessionId: props.scope?.sessionId, scope: props.scope, uiConversation: getUiConversation, sessions: ctx.sessions, ctx })
  }), 'narrative-anchor: worldbook tab')

  console.log('[narrative-anchor] 客户端已注册 3 个侧边栏 tab')
    }

    module.exports.name = 'dsh-tavern-narrative-anchor'
    module.exports.inject = ['tavernUi', 'betterSidebar', 'sessions']

    return module.exports;
  }
});
