// Narrative Anchor panel using only DSH Tavern's stable tavernUi API v2.
// 视觉对齐原版 v0.9.25 的会话世界书页：卡片分区、蓝色胶囊选中、chip 标签筛选、条目卡。
window.__ModuleLoader__.load({
  id: 'narrative-anchor-v2',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const PANEL_CSS = `
.na-root{--na-line:var(--dsh-tavern-accent-hairline,rgba(128,128,128,.3));--na-accent:var(--dsh-tavern-accent,#4f6ef7);--na-soft:var(--dsh-tavern-accent-soft,rgba(79,110,247,.14));--na-edge:var(--dsh-tavern-accent-border,var(--na-accent));
  display:flex;flex-direction:column;gap:10px;font-size:13px;line-height:1.55;padding:10px 12px 24px;box-sizing:border-box;height:100%;overflow:auto}
.na-tabs{display:flex;gap:6px;flex-wrap:wrap;align-items:center;flex:none}
.na-tab{padding:3px 10px;border-radius:6px;border:1px solid var(--na-line);background:transparent;color:inherit;cursor:pointer;font:inherit}
.na-tab[aria-pressed=true]{background:var(--na-accent);border-color:var(--na-accent);color:#fff}
.na-card{border:1px solid var(--na-line);border-radius:8px;padding:10px;display:flex;flex-direction:column;gap:8px}
.na-sec{display:flex;align-items:center;gap:8px;font-weight:600;font-size:13px}
.na-sec::before{content:"";width:3px;height:14px;border-radius:2px;background:var(--na-accent);flex:none}
.na-grow{flex:1;min-width:0;font-weight:400;font-size:12px;opacity:.7;text-align:right}
.na-input,.na-select,.na-area{width:100%;box-sizing:border-box;padding:4px 8px;border-radius:6px;border:1px solid var(--na-line);background:transparent;color:inherit;font:inherit}
.na-select option{background:var(--dsh-tavern-surface,#1e1e24);color:var(--dsh-tavern-text,#e0e0e0)}
.na-area{resize:vertical}
.na-btn{padding:2px 9px;border-radius:6px;border:1px solid var(--na-line);background:transparent;color:inherit;cursor:pointer;font:inherit;font-size:12px;white-space:nowrap}
.na-btn:hover:not([disabled]){border-color:var(--na-accent);color:var(--na-accent)}
.na-btn[disabled]{opacity:.45;cursor:default}
.na-btn.na-primary{background:var(--na-accent);border-color:var(--na-accent);color:#fff}
.na-chip{padding:1px 9px;border-radius:6px;border:1px solid var(--na-line);background:transparent;color:inherit;cursor:pointer;font:inherit;font-size:12px;white-space:nowrap}
.na-chip[aria-pressed=true]{background:var(--na-accent);border-color:var(--na-accent);color:#fff}
.na-badge{font-size:11px;padding:0 6px;border-radius:5px;border:1px solid var(--na-line);white-space:nowrap;opacity:.9}
.na-badge.na-on{background:var(--na-soft);border-color:var(--na-edge);color:var(--na-accent);opacity:1}
.na-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.na-entry{border:1px solid var(--na-line);border-radius:8px;padding:8px 10px;display:flex;flex-direction:column;gap:6px}
.na-title{font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.na-meta{font-size:12px;opacity:.7;word-break:break-word}
.na-body{white-space:pre-wrap;word-break:break-word}
.na-list{display:flex;flex-direction:column;gap:8px}
.na-kv{display:grid;grid-template-columns:auto minmax(0,1fr);gap:6px 10px;align-items:center}
.na-kv>span:first-child{opacity:.7;white-space:nowrap}
.na-empty{opacity:.6;font-size:12px;margin:0}
.na-alert{color:var(--dsh-tavern-accent-error,#c64545);font-size:12px}
.na-ok{font-size:12px;opacity:.85}
.na-srow{display:flex;gap:6px;align-items:center;border-top:1px solid var(--na-line);padding-top:6px}
.na-tree{display:flex;flex-direction:column;gap:4px;font-size:12px}
.na-tree-node{border-left:2px solid var(--na-edge);padding-left:8px}
`
    if (typeof document !== 'undefined' && !document.getElementById('narrative-anchor-panel-css')) {
      const style = document.createElement('style')
      style.id = 'narrative-anchor-panel-css'
      style.textContent = PANEL_CSS
      document.head.appendChild(style)
    }

    const TAGS = [['anchor', '锚点'], ['branch', '支线'], ['manual', '人工'], ['force', '⚡强制注入'],
      ['inContext', '📖在上下文'], ['disabled', '已停用'], ['hit', '关键词命中']]

    function Field({ label, value, onChange, multiline = false, rows = 3, placeholder = '' }) {
      const props = { className: multiline ? 'na-area' : 'na-input', value: value ?? '', placeholder,
        onChange: event => onChange(event.target.value) }
      return h('label', { className: 'na-kv' }, h('span', null, label),
        multiline ? h('textarea', { ...props, rows }) : h('input', { ...props, type: 'text' }))
    }
    function slug(value) {
      const text = String(value || '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-')
      return (text.replace(/^-+|-+$/g, '').slice(0, 42) || 'book') + '-' + Date.now().toString(36).slice(-6)
    }
    const blankEntry = () => ({ id: '', title: '', keys: '', secondaryKeys: '', content: '', category: '', constant: false, force: false, bound: true, enabled: true })
    const flagsOf = entry => entry.flags || { anchor: entry.category === '锚点', branch: entry.category === '支线', manual: entry.auto !== true,
      force: entry.force === true, inContext: entry.constant === true || entry.force === true, disabled: entry.enabled === false, hit: false }

    function AnchorPanel({ api, gameId, visible, initialTab = 'status' }) {
      const [tab, setTab] = React.useState(initialTab)
      const [state, setState] = React.useState(null)
      const [turn, setTurn] = React.useState(0)
      const [textVersion, setTextVersion] = React.useState(null)
      const [stateTurn, setStateTurn] = React.useState(0)
      const [config, setConfig] = React.useState({ maxStm: 7 })
      const [entries, setEntries] = React.useState([])
      const [shared, setShared] = React.useState({ books: [], families: [] })
      const [family, setFamily] = React.useState(null)
      const [families, setFamilies] = React.useState([])
      const [aliasDraft, setAliasDraft] = React.useState({})
      const [draft, setDraft] = React.useState(blankEntry())
      const [editingId, setEditingId] = React.useState('')
      const [sharedDraft, setSharedDraft] = React.useState({ id: '', title: '', autoBind: false, entries: [] })
      const [editingShared, setEditingShared] = React.useState(false)
      const [query, setQuery] = React.useState('')
      const [category, setCategory] = React.useState('')
      const [tags, setTags] = React.useState([])
      const [intersect, setIntersect] = React.useState(false)
      const [selected, setSelected] = React.useState([])
      const [fromTurn, setFromTurn] = React.useState('1')
      const [toTurn, setToTurn] = React.useState('25')
      const [loading, setLoading] = React.useState(false)
      const [saving, setSaving] = React.useState(false)
      const [backfilling, setBackfilling] = React.useState(false)
      const [error, setError] = React.useState('')
      const [notice, setNotice] = React.useState('')
      const callHost = React.useCallback((name, args) => api.callHost('narrative-anchor-v2/' + name, args), [api])

      const load = React.useCallback(async () => {
        if (!gameId) return
        setLoading(true); setError(''); setNotice('')
        try {
          const [anchor, book] = await Promise.all([callHost('get-state', { gameId }), callHost('list-entries', { gameId })])
          setState(anchor?.state || null); setTurn(Number(anchor?.turn) || 0); setStateTurn(Number(anchor?.stateTurn) || 0)
          setTextVersion(anchor?.textVersion || null); setConfig(anchor?.config || { maxStm: 7 })
          setEntries(Array.isArray(book?.entries) ? book.entries : [])
          setFamily(book?.family || null); setFamilies(Array.isArray(book?.families) ? book.families : [])
          try { setShared(await callHost('list-shared-books', { gameId })) }
          catch (caught) { setShared({ books: [], families: [] }); setError('共享书目不可用：' + String(caught?.message || caught)) }
        } catch (caught) { setError(String(caught?.message || caught)) }
        finally { setLoading(false) }
      }, [gameId, callHost])
      React.useEffect(() => { if (visible && gameId) void load() }, [visible, gameId, load])

      async function saveStateData(data) {
        if (!turn || !data) return
        setSaving(true); setError(''); setNotice('')
        try { await callHost('save-state', { gameId, turn, textVersion, data }); setNotice('叙事状态已保存到当前正文版本。') }
        catch (caught) { setError(String(caught?.message || caught)) }
        finally { setSaving(false) }
      }
      async function saveState() { await saveStateData(state) }
      async function saveSettings() {
        setSaving(true); setError('')
        try {
          const result = await callHost('save-config', { gameId, maxStm: Number(config.maxStm),
            injectPosition: config.injectPosition === 'after' ? 'after' : 'before' })
          setConfig(result.config); setNotice('设置已保存（下一轮请求生效）。')
        }
        catch (caught) { setError(String(caught?.message || caught)) }
        finally { setSaving(false) }
      }
      function updateCurrent(key, value) {
        const listKeys = new Set(['characters', 'environment', 'items'])
        const next = listKeys.has(key) ? String(value).split(/\r?\n|[,，、]+/).map(item => item.trim()).filter(Boolean) : value
        setState(previous => ({ ...previous, currentState: { ...(previous?.currentState || {}), [key]: next } }))
      }
      function splitKeys(value) { return String(value || '').split(/[\n,，、]+/).map(item => item.trim()).filter(Boolean) }
      function resetEntryDraft() { setEditingId(''); setDraft(blankEntry()) }
      function startEdit(entry) {
        setEditingId(entry.id)
        setDraft({ ...entry, keys: (entry.keys || []).join('，'), secondaryKeys: (entry.secondaryKeys || []).join('，') })
      }
      async function saveWorldbook(next, message) {
        setSaving(true); setError('')
        try { await callHost('save-worldbook', { gameId, entries: next }); setEntries(next); setSelected([]); setNotice(message) }
        catch (caught) { setError(String(caught?.message || caught)) }
        finally { setSaving(false) }
      }
      async function commitEntry() {
        const id = editingId || draft.id || slug(draft.title)
        // 编辑自动条目时保留 auto/autoKeys，条目继续跟随锚点更新。
        const base = editingId ? (entries.find(item => item.id === editingId) || {}) : {}
        const next = { ...base, id, title: draft.title, keys: splitKeys(draft.keys), secondaryKeys: splitKeys(draft.secondaryKeys), content: draft.content,
          category: draft.category, constant: draft.constant, force: draft.force, bound: draft.bound, enabled: draft.enabled }
        const updated = editingId ? entries.map(item => item.id === editingId ? next : item) : [...entries, next]
        resetEntryDraft()
        await saveWorldbook(updated, '临时世界书已保存并进入 Tavern 原生召回池。')
      }
      async function deleteSelected(ids) {
        if (!ids.length) return
        setSaving(true); setError('')
        try { await callHost('delete-worldbook-entries', { gameId, ids }); setEntries(previous => previous.filter(item => !ids.includes(item.id))); setSelected([]); setNotice(`已删除 ${ids.length} 条临时世界书条目。`) }
        catch (caught) { setError(String(caught?.message || caught)) }
        finally { setSaving(false) }
      }
      async function exportBook(ids) {
        try {
          const result = await callHost('export-worldbook', { gameId, ids })
          const blob = new Blob([result.text], { type: 'application/json;charset=utf-8' }), url = URL.createObjectURL(blob), link = document.createElement('a')
          link.href = url; link.download = result.filename; link.click(); URL.revokeObjectURL(url); setNotice('临时书目已导出为 JSON。')
        } catch (caught) { setError(String(caught?.message || caught)) }
      }
      async function backfill() {
        const from = Number(fromTurn), to = Number(toTurn)
        if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 1 || to < from || to - from + 1 > 25) { setError('请输入有效范围；单次最多 25 轮。'); return }
        setBackfilling(true); setError(''); setNotice('正在读取历史并整理锚点…')
        try { const result = await callHost('backfill', { gameId, from, to }); setNotice(`回填完成：读取 ${result.turnsRead} 轮（第 ${result.from}–${result.to} 轮）。`); await load() }
        catch (caught) { setError(String(caught?.message || caught)); setNotice('') }
        finally { setBackfilling(false) }
      }
      async function rebuildEntries() {
        setSaving(true); setError('')
        try { const result = await callHost('rebuild-entries', { gameId }); await load(); setNotice(`已按当前锚点重建条目，共 ${result.count} 条。`) }
        catch (caught) { setError(String(caught?.message || caught)) }
        finally { setSaving(false) }
      }
      async function bindShared(id, bound) {
        try { await callHost('bind-shared-book', { gameId, id, bound }); await load() }
        catch (caught) { setError(String(caught?.message || caught)) }
      }
      async function setLocalBound(entry, bound) {
        try { await callHost('bind-local-worldbook', { gameId, id: entry.id, bound }); await load() }
        catch (caught) { setError(String(caught?.message || caught)) }
      }
      function resetSharedDraft() { setEditingShared(false); setSharedDraft({ id: '', title: '', autoBind: false, entries: [] }) }
      async function saveSharedBook() {
        if (!sharedDraft.title.trim() || !sharedDraft.entries.length) { setError('请填写书名并选择至少一条临时书条目。'); return }
        const id = sharedDraft.id.trim() || slug(sharedDraft.title)
        try { await callHost('save-shared-book', { id, title: sharedDraft.title, entries: sharedDraft.entries, autoBind: sharedDraft.autoBind }); resetSharedDraft(); await load(); setNotice('共享书目已保存。') }
        catch (caught) { setError(String(caught?.message || caught)) }
      }
      async function deleteShared(id) {
        try { await callHost('delete-shared-book', { id }); await load() }
        catch (caught) { setError(String(caught?.message || caught)) }
      }
      async function importEntries(file) {
        try {
          const data = JSON.parse(await file.text()), incoming = Array.isArray(data) ? data : data.entries
          if (!Array.isArray(incoming)) throw new Error('JSON 中没有 entries 数组')
          const mapped = incoming.map((entry, index) => ({ ...entry, id: entry.id || slug(entry.title || `导入-${index + 1}`) }))
          await saveWorldbook([...entries, ...mapped], `已导入 ${mapped.length} 条临时书条目。`)
        } catch (caught) { setError(String(caught?.message || caught)) }
      }
      async function renameMember(targetGameId, alias) {
        setError('')
        try { await callHost('rename-member', { gameId, targetGameId, alias }); setAliasDraft(value => ({ ...value, [targetGameId]: '' })); await load(); setNotice('别名已更新，支线条目标题实时刷新。') }
        catch (caught) { setError(String(caught?.message || caught)) }
      }
      async function unlinkMember(targetGameId) {
        setError('')
        try { await callHost('unlink-member', { gameId, targetGameId }); await load(); setNotice('已解除关联。') }
        catch (caught) { setError(String(caught?.message || caught)) }
      }
      async function mergeFamilies(fromFamilyId) {
        setError('')
        try { await callHost('merge-families', { gameId, fromFamilyId }); await load(); setNotice('已并入本族。') }
        catch (caught) { setError(String(caught?.message || caught)) }
      }
      async function syncFamily() {
        setError('')
        try { await callHost('sync-family', { gameId }); await load(); setNotice('已同步族内条目。') }
        catch (caught) { setError(String(caught?.message || caught)) }
      }

      if (!gameId) return h('div', { className: 'na-root' }, h('p', { className: 'na-empty' }, '请先打开一局游玩对话。'))
      if (loading) return h('div', { className: 'na-root' }, h('p', { className: 'na-empty' }, '正在加载叙事锚定…'))

      const current = state?.currentState || {}
      const categories = [...new Set(entries.map(entry => entry.category).filter(Boolean))]
      const counts = TAGS.reduce((map, [key]) => ({ ...map, [key]: entries.filter(entry => flagsOf(entry)[key]).length }), {})
      const text = entry => (entry.title + ' ' + entry.content + ' ' + (entry.keys || []).join(' ')).toLowerCase()
      const filtered = entries.filter(entry => {
        if (category && entry.category !== category) return false
        if (query && !text(entry).includes(query.toLowerCase())) return false
        if (!tags.length) return true
        return intersect ? tags.every(tag => flagsOf(entry)[tag]) : tags.some(tag => flagsOf(entry)[tag])
      })
      const tree = state?.memoryTree || []
      const referenced = new Set(tree.flatMap(node => node.children || []))
      const roots = tree.filter(node => !referenced.has(node.id)).sort((a, b) => (a.from?.[0] || 0) - (b.from?.[0] || 0))
      const unmerged = (state?.stm || []).filter(row => !row.mergedInto)
      const chip = (key, label, count) => h('button', { key, type: 'button', className: 'na-chip', 'aria-pressed': tags.includes(key),
        onClick: () => setTags(value => value.includes(key) ? value.filter(item => item !== key) : [...value, key]) },
        count === undefined ? label : `${label}(${count})`)

      const nav = h('div', { className: 'na-tabs' },
        ...[['settings', '设置'], ['status', '状态'], ['worldbook', '临时世界书']].map(([id, label]) =>
          h('button', { key: id, type: 'button', className: 'na-tab', 'aria-pressed': tab === id, onClick: () => setTab(id) }, label)),
        h('span', { className: 'na-grow' }), h('button', { type: 'button', className: 'na-btn', onClick: () => void load() }, '刷新'))
      const messages = error ? h('div', { role: 'alert', className: 'na-alert' }, error) : null
      const status = notice ? h('div', { role: 'status', className: 'na-ok' }, notice) : null

      let body
      if (tab === 'settings') {
        body = h(React.Fragment, null,
          h('div', { className: 'na-card' },
            h('div', { className: 'na-sec' }, '本局设置', h('span', { className: 'na-grow' }, `第 ${turn || '—'} 轮`)),
            h('label', { className: 'na-kv' }, h('span', null, '近期 STM 注入上限'),
              h('input', { className: 'na-input', type: 'number', min: 1, max: 50, value: config.maxStm || 7,
                onChange: event => setConfig({ ...config, maxStm: event.target.value }) })),
            h('p', { className: 'na-empty' }, '注入时保留最近的 N 条未归并 STM；更早的内容由历忆树按 7/5/10 规则逐级归并。'),
            h('label', { className: 'na-kv' }, h('span', null, '注入位置'),
              h('select', { className: 'na-select', value: config.injectPosition === 'after' ? 'after' : 'before',
                onChange: event => setConfig({ ...config, injectPosition: event.target.value }) },
                h('option', { value: 'before' }, '写作规则之前（原版默认）'),
                h('option', { value: 'after' }, '写作规则之后'))),
            h('p', { className: 'na-empty' }, '「之前」把锚点放在 Tavern 自己的上下文/写作规则前面（更像素材）；「之后」放在后面（更靠近输出位置）。'),
            h('div', { className: 'na-row' }, h('button', { type: 'button', className: 'na-btn na-primary', disabled: saving, onClick: () => void saveSettings() }, saving ? '保存中…' : '保存设置'))),
          h('div', { className: 'na-card' },
            h('div', { className: 'na-sec' }, '全局书目绑定', h('span', { className: 'na-grow' }, `${shared.books?.length || 0} 本`)),
            h('p', { className: 'na-empty' }, '共享书目只存在插件自己的 global.json，不写 Tavern 官方世界书文件或聊天记录。'),
            shared.books?.length ? h('div', { className: 'na-list' }, ...shared.books.map(book => h('label', { key: book.id, className: 'na-srow' },
              h('input', { type: 'checkbox', checked: book.bound && !book.excluded, onChange: event => void bindShared(book.id, event.target.checked) }),
              h('span', { style: { flex: 1 } }, `${book.title}（${book.entries.length} 条）`),
              h('span', { className: 'na-meta' }, book.autoBind ? '自动共享' : book.excluded ? '本局排除' : '手动绑定'))))
              : h('p', { className: 'na-empty' }, '尚无全局书目。可在「临时世界书」页创建。')))
      } else if (tab === 'status') {
        body = h(React.Fragment, null,
          h('div', { className: 'na-card' },
            h('div', { className: 'na-sec' }, '本局进度', h('span', { className: 'na-grow' },
              turn ? `编辑第 ${turn} 轮${stateTurn && stateTurn !== turn ? `（数据来源第 ${stateTurn} 轮）` : ''}` : '暂无已完成轮次')),
            h('details', null,
              h('summary', { style: { cursor: 'pointer' } }, '回填旧消息（每次最多 25 轮）'),
              h('p', { className: 'na-empty' }, '读取已完成历史，一次性整理成锚点，不改原正文。长历史请分段回填。'),
              h('div', { className: 'na-row' },
                h('label', { className: 'na-row' }, '起始轮', h('input', { className: 'na-input', style: { width: 70 }, type: 'number', min: 1, value: fromTurn, onChange: event => setFromTurn(event.target.value) })),
                h('label', { className: 'na-row' }, '结束轮', h('input', { className: 'na-input', style: { width: 70 }, type: 'number', min: 1, value: toTurn, onChange: event => setToTurn(event.target.value) })),
                h('button', { type: 'button', className: 'na-btn', disabled: backfilling, onClick: () => void backfill() }, backfilling ? '回填中…' : '回填范围')))),
          h('div', { className: 'na-card' },
            h('div', { className: 'na-sec' }, '当前状态'),
            !state ? h('p', { className: 'na-empty' }, '尚无锚点。完成一轮官方结算或回填历史即可建立。') : h(React.Fragment, null,
              ...[['time', '时间'], ['world', '世界'], ['location', '地点'], ['focus', '叙事备忘']].map(([key, label]) =>
                h(Field, { key, label, value: current[key], onChange: value => updateCurrent(key, value), multiline: key === 'focus', rows: 2 })),
              ...[['characters', '在场人物'], ['environment', '环境'], ['items', '关键物品']].map(([key, label]) =>
                h(Field, { key, label: label + '（每行一项）', value: (current[key] || []).join('\n'), onChange: value => updateCurrent(key, value), multiline: true, rows: 3 })),
              h('div', { className: 'na-row' }, h('button', { type: 'button', className: 'na-btn na-primary', disabled: saving || !turn, onClick: () => void saveState() }, saving ? '保存中…' : '保存状态')))),
          state ? h('div', { className: 'na-card' },
            h('div', { className: 'na-sec' }, '记忆', h('span', { className: 'na-grow' }, `未归并 STM ${unmerged.length} · 历忆树 ${roots.length} · 情报 ${state.knownFacts?.length || 0} · 回填 ${state.backfilledStm?.length || 0}`)),
            roots.length ? h('div', { className: 'na-tree' }, ...roots.map(node => h('div', { key: node.id, className: 'na-tree-node' },
              h('b', null, `${node.title}（第 ${node.depth} 层）`), h('div', { className: 'na-meta' }, node.summary)))) : null,
            h('h4', { style: { margin: '8px 0 0' } }, '近期 STM'),
            ...(state.stm || []).slice(-10).reverse().map((row, index) => h('div', { key: 'stm-' + index },
              h('b', null, `第 ${row.turn} 轮 ${row.title}`), row.mergedInto ? h('span', { className: 'na-badge' }, '已归并') : null,
              h('div', { className: 'na-meta' }, row.summary))),
            state.ltm?.length ? h('details', null, h('summary', { style: { cursor: 'pointer' } }, `人工长期记忆 ${state.ltm.length}`),
              ...state.ltm.slice(-20).reverse().map((row, index) => h('div', { key: 'ltm-' + index }, h('b', null, row.title), h('div', { className: 'na-meta' }, row.summary)))) : null,
            state.backfilledStm?.length ? h('details', null, h('summary', { style: { cursor: 'pointer' } }, `历史回填 STM ${state.backfilledStm.length}`),
              ...state.backfilledStm.slice(-50).reverse().map((row, index) => h('div', { key: 'bf-' + index }, `第 ${row.turn} 轮 ${row.title}：${row.summary}`))) : null,
            h('h4', { style: { margin: '8px 0 0' } }, `已知情报 ${state.knownFacts?.length || 0}`),
            ...(state.knownFacts || []).slice(-30).reverse().map((row, index) => h('div', { key: 'fact-' + index }, h('b', null, row.title), h('div', { className: 'na-meta' }, row.summary)))) : null,
          state ? (() => {
            const links = Array.isArray(state.foreshadowing) ? state.foreshadowing : []
            const openLinks = links.filter(row => row.status !== 'closed')
            const closedLinks = links.filter(row => row.status === 'closed')
            const flip = (id, closed) => {
              const next = { ...state, foreshadowing: (state.foreshadowing || [])
                .map(row => row.id === id ? { ...row, status: closed ? 'closed' : 'open' } : row) }
              setState(next)
              void saveStateData(next)
            }
            return h('div', { className: 'na-card' },
              h('div', { className: 'na-sec' }, '伏笔库', h('span', { className: 'na-grow' }, `未兑现 ${openLinks.length} · 已兑现 ${closedLinks.length}`)),
              h('p', { className: 'na-empty' }, '只有「未兑现」的伏笔会被注入；标记已兑现后不再注入，但仍留在这里备查。'),
              openLinks.length ? h('div', { className: 'na-list' }, ...openLinks.slice(-30).reverse().map(row => h('div', { key: row.id, className: 'na-srow' },
                h('span', { style: { flex: 1 } }, h('b', null, row.title), row.detail ? h('div', { className: 'na-meta' }, row.detail) : null),
                h('button', { type: 'button', className: 'na-btn', onClick: () => flip(row.id, true) }, '标记已兑现'))))
                : h('p', { className: 'na-empty' }, '暂无未兑现伏笔。'),
              closedLinks.length ? h('details', null, h('summary', { style: { cursor: 'pointer' } }, `已兑现 ${closedLinks.length}`),
                ...closedLinks.slice(-30).reverse().map(row => h('div', { key: row.id, className: 'na-srow' },
                  h('span', { style: { flex: 1 } }, h('b', null, row.title), row.detail ? h('div', { className: 'na-meta' }, row.detail) : null),
                  h('button', { type: 'button', className: 'na-btn', onClick: () => flip(row.id, false) }, '重新打开')))) : null)
          })() : null)
      } else {
        body = h(React.Fragment, null,
          h('div', { className: 'na-card' },
            h('div', { className: 'na-sec' }, '会话临时世界书', h('span', { className: 'na-grow' }, `${filtered.length} / ${entries.length} 条`)),
            h('input', { className: 'na-input', placeholder: '检索：标题 / 关键词 / 正文', value: query, onChange: event => setQuery(event.target.value) }),
            h('div', { className: 'na-row' },
              h('button', { type: 'button', className: 'na-chip', 'aria-pressed': tags.length === 0, onClick: () => setTags([]) }, '全部'),
              ...TAGS.slice(0, 3).map(([key, label]) => chip(key, label, counts[key]))),
            h('div', { className: 'na-row' },
              ...TAGS.slice(3).map(([key, label]) => chip(key, label, counts[key])),
              h('label', { className: 'na-row' }, h('input', { type: 'checkbox', checked: intersect, onChange: event => setIntersect(event.target.checked) }), '交集')),
            categories.length ? h('div', { className: 'na-row' },
              h('span', { className: 'na-meta' }, '分类'),
              h('select', { className: 'na-select', style: { width: 140 }, value: category, onChange: event => setCategory(event.target.value) },
                h('option', { value: '' }, '全部分类'), ...categories.map(value => h('option', { key: value, value }, value)))) : null,
            h('div', { className: 'na-row' },
              h('button', { type: 'button', className: 'na-btn', onClick: () => setSelected(filtered.map(entry => entry.id)) }, '全选筛选结果'),
              h('button', { type: 'button', className: 'na-btn', disabled: !selected.length, onClick: () => void deleteSelected(selected) }, `批量删除 ${selected.length}`),
              h('button', { type: 'button', className: 'na-btn', onClick: () => void exportBook(selected) }, '导出所选'),
              h('button', { type: 'button', className: 'na-btn', onClick: () => void exportBook([]) }, '导出全部'),
              h('label', { className: 'na-btn' }, '导入 JSON', h('input', { type: 'file', accept: 'application/json,.json', style: { display: 'none' },
                onChange: event => { const file = event.target.files?.[0]; if (file) void importEntries(file); event.target.value = '' } })),
              h('button', { type: 'button', className: 'na-btn', disabled: saving, onClick: () => void rebuildEntries() }, '重建锚点条目')),
            h('p', { className: 'na-empty' }, '启用并绑定的条目进入 Tavern 原生召回池；「锚点」「支线」条目由结算与族谱自动维护，不写官方世界书文件。'),
            h('div', { className: 'na-list' },
              ...filtered.map(entry => {
                const flags = flagsOf(entry)
                return h('article', { key: entry.id, className: 'na-entry' },
                  h('div', { className: 'na-row' },
                    h('input', { type: 'checkbox', checked: selected.includes(entry.id),
                      onChange: event => setSelected(value => event.target.checked ? [...new Set([...value, entry.id])] : value.filter(id => id !== entry.id)) }),
                    h('span', { className: 'na-title' }, entry.title),
                    ...TAGS.filter(([key]) => flags[key]).map(([key, label]) => h('span', { key, className: 'na-badge na-on' }, label))),
                  h('div', { className: 'na-meta' }, `${entry.category || '未分类'} · ID ${entry.id} · 关键词 ${(entry.keys || []).join('、') || '—'}${entry.secondaryKeys?.length ? '；次要 ' + entry.secondaryKeys.join('、') : ''}`),
                  h('div', { className: 'na-body' }, entry.content),
                  h('div', { className: 'na-row' },
                    h('button', { type: 'button', className: 'na-btn', onClick: () => startEdit(entry) }, '编辑'),
                    h('button', { type: 'button', className: 'na-btn', onClick: () => void setLocalBound(entry, entry.bound === false) }, entry.bound === false ? '绑定本局' : '解除绑定'),
                    h('button', { type: 'button', className: 'na-btn', onClick: () => void saveWorldbook(entries.map(row => row.id === entry.id ? { ...row, enabled: row.enabled === false } : row), '条目状态已更新。') }, entry.enabled === false ? '启用' : '停用'),
                    h('button', { type: 'button', className: 'na-btn', onClick: () => void saveWorldbook(entries.map(row => row.id === entry.id ? { ...row, constant: !row.constant } : row), '常驻设置已更新。') }, entry.constant ? '取消常驻' : '设为常驻'),
                    h('button', { type: 'button', className: 'na-btn', onClick: () => void saveWorldbook(entries.map(row => row.id === entry.id ? { ...row, force: !row.force } : row), '强制召回设置已更新。') }, entry.force ? '取消强制' : '强制召回'),
                    h('button', { type: 'button', className: 'na-btn', onClick: () => void deleteSelected([entry.id]) }, '删除'))
                )
              }))),
          h('details', { open: !!editingId, className: 'na-card' },
            h('summary', { style: { cursor: 'pointer' } }, editingId ? '编辑条目' : '新增条目'),
            h(Field, { label: '标题', value: draft.title, onChange: value => setDraft({ ...draft, title: value }) }),
            h(Field, { label: 'ID', value: draft.id, onChange: value => setDraft({ ...draft, id: value }), placeholder: '留空自动生成' }),
            h(Field, { label: '关键词', value: draft.keys, onChange: value => setDraft({ ...draft, keys: value }), placeholder: '逗号或换行分隔' }),
            h(Field, { label: '次要关键词', value: draft.secondaryKeys, onChange: value => setDraft({ ...draft, secondaryKeys: value }), placeholder: '需同时匹配一个' }),
            h(Field, { label: '分类/标签', value: draft.category, onChange: value => setDraft({ ...draft, category: value }), placeholder: '留空为「未分类」' }),
            h(Field, { label: '内容', value: draft.content, onChange: value => setDraft({ ...draft, content: value }), multiline: true, rows: 7 }),
            h('div', { className: 'na-row' },
              ...[['constant', '常驻'], ['force', '强制召回'], ['bound', '绑定本局'], ['enabled', '启用']].map(([key, label]) =>
                h('label', { key, className: 'na-row' }, h('input', { type: 'checkbox', checked: draft[key] === true, onChange: event => setDraft({ ...draft, [key]: event.target.checked }) }), label))),
            h('div', { className: 'na-row' },
              h('button', { type: 'button', className: 'na-btn na-primary', disabled: saving, onClick: () => void commitEntry() }, saving ? '保存中…' : editingId ? '保存修改' : '新增条目'),
              editingId ? h('button', { type: 'button', className: 'na-btn', onClick: resetEntryDraft }, '取消') : null)),
          h('details', { className: 'na-card' },
            h('summary', { style: { cursor: 'pointer' } }, `全局共享书目（${shared.books?.length || 0}）`),
            h('p', { className: 'na-empty' }, '把本局条目发布成共享书目，可在其它会话绑定或设自动共享。'),
            h(Field, { label: '书目名称', value: sharedDraft.title, onChange: value => setSharedDraft({ ...sharedDraft, title: value }) }),
            h(Field, { label: '全局 ID', value: sharedDraft.id, onChange: value => setSharedDraft({ ...sharedDraft, id: value }), placeholder: '留空自动生成' }),
            h('label', { className: 'na-row' }, h('input', { type: 'checkbox', checked: sharedDraft.autoBind, onChange: event => setSharedDraft({ ...sharedDraft, autoBind: event.target.checked }) }), '自动绑定全部会话'),
            h('div', { className: 'na-row' },
              h('button', { type: 'button', className: 'na-btn', onClick: () => setSharedDraft({ ...sharedDraft, entries: entries.filter(entry => !selected.length || selected.includes(entry.id)) }) }, selected.length ? `使用所选 ${selected.length} 条` : `使用全部 ${entries.length} 条`),
              h('button', { type: 'button', className: 'na-btn na-primary', disabled: !sharedDraft.title || !sharedDraft.entries.length, onClick: () => void saveSharedBook() }, editingShared ? '更新共享书目' : '创建共享书目'),
              editingShared ? h('button', { type: 'button', className: 'na-btn', onClick: resetSharedDraft }, '取消') : null),
            shared.books?.length ? h('div', { className: 'na-list' }, ...shared.books.map(book => h('div', { key: book.id, className: 'na-srow' },
              h('input', { type: 'checkbox', checked: book.bound && !book.excluded, onChange: event => void bindShared(book.id, event.target.checked) }),
              h('span', { style: { flex: 1 } }, `${book.title}（${book.entries.length}）${book.autoBind ? ' · 自动绑定' : ''}`),
              h('button', { type: 'button', className: 'na-btn', onClick: () => { setEditingShared(true); setSharedDraft({ id: book.id, title: book.title, autoBind: book.autoBind, entries: book.entries }) } }, '编辑'),
              h('button', { type: 'button', className: 'na-btn', onClick: () => void deleteShared(book.id) }, '删除')))) : null),
          h('details', { className: 'na-card' },
            h('summary', { style: { cursor: 'pointer' } }, `支线族谱${family ? `（${family.members.length} 局）` : ''}`),
            family ? h(React.Fragment, null,
              h('p', { className: 'na-empty' }, '族内成员的「锚点」条目会以【别名】前缀流入本局，作为「支线」条目参与原生召回。建支线仍用 Tavern 原生「创建分支」。'),
              h('div', { className: 'na-list' }, ...family.members.map(member => h('div', { key: member.gameId, className: 'na-srow' },
                h('span', { style: { flex: 1 } }, `${member.gameId === gameId ? '本局' : member.gameId}${member.alias ? `（${member.alias}）` : ''}`),
                h('input', { className: 'na-input', style: { width: 100 }, placeholder: '别名',
                  value: aliasDraft[member.gameId] ?? member.alias ?? '', onChange: event => setAliasDraft(value => ({ ...value, [member.gameId]: event.target.value })) }),
                h('button', { type: 'button', className: 'na-btn', onClick: () => void renameMember(member.gameId, aliasDraft[member.gameId] ?? member.alias ?? '') }, '改名'),
                member.gameId === gameId ? null : h('button', { type: 'button', className: 'na-btn', onClick: () => void unlinkMember(member.gameId) }, '解除关联')))),
              h('div', { className: 'na-row' }, h('button', { type: 'button', className: 'na-btn', onClick: () => void syncFamily() }, '手动同步族内条目')))
              : h('p', { className: 'na-empty' }, '本局还没有支线族谱；用 Tavern 原生「创建分支」后会自动登记。'),
            families.filter(item => !family || item.id !== family.id).length
              ? h('div', { className: 'na-list' }, ...families.filter(item => !family || item.id !== family.id).map(item => h('div', { key: item.id, className: 'na-srow' },
                h('span', { style: { flex: 1 } }, `其它族谱（${item.members.length} 局）`),
                h('button', { type: 'button', className: 'na-btn', disabled: !family, onClick: () => void mergeFamilies(item.id) }, '并入本族'))))
              : null))
      }
      return h('div', { className: 'na-root' }, nav, messages, status, body)
    }

    return {
      name: 'narrative-anchor-v2',
      inject: ['tavernUi'],
      apply(ctx) {
        if (ctx.tavernUi.apiVersion < 2) return
        const api = ctx.tavernUi
        api.registerPanel({ id: 'settings', title: '设置', render: props => h(AnchorPanel, { ...props, api, initialTab: 'settings' }) })
        api.registerPanel({ id: 'status', title: '状态', render: props => h(AnchorPanel, { ...props, api, initialTab: 'status' }) })
        api.registerPanel({ id: 'worldbook', title: '会话世界书', render: props => h(AnchorPanel, { ...props, api, initialTab: 'worldbook' }) })
        api.registerStartGroup({ title: '叙事锚定', tabs: ['settings', 'status', 'worldbook'] })
      },
    }
  },
})
