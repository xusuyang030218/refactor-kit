// RefactorKit 浏览器端：DSH 右侧栏 "RefactorKit" 标签页（08 文档）。
// 手写的模块加载器包装（无构建步骤）；只依赖平台提供的 react；样式只用 DSH 主题令牌。
window.__ModuleLoader__.load({
  id: 'dsh-plugin-refactorkit',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    const React = require('react')
    const { useState, useEffect, useMemo, useRef, useCallback } = React
    const h = React.createElement

    const TAB_ID = 'dsh-plugin-refactorkit'
    const TAB_KIND = 'refactorkit'
    const API = '/refactorkit/api'

    // ───────────── 数据访问 ─────────────
    async function call(method, path, payload) {
      const opts = { method, cache: 'no-store', headers: {} }
      let url = API + path
      if (method === 'GET' && payload) {
        const qs = new URLSearchParams()
        for (const [k, v] of Object.entries(payload)) if (v !== undefined && v !== null) qs.set(k, String(v))
        url += '?' + qs.toString()
      } else if (payload) {
        opts.headers['content-type'] = 'application/json'
        opts.body = JSON.stringify(payload)
      }
      const res = await fetch(url, opts)
      const body = await res.json().catch(() => ({ error: 'HTTP ' + res.status }))
      if (!res.ok) throw new Error(body.error || ('HTTP ' + res.status))
      return body
    }
    const api = {
      context: (session) => call('GET', '/context', { session }),
      state: (root) => call('GET', '/state', { root }),
      review: (payload) => call('POST', '/review', payload),
      ack: (payload) => call('POST', '/ack', payload),
      config: (root) => call('GET', '/config', { root }),
      saveConfig: (root, config) => call('POST', '/config', { root, config }),
      detect: (payload) => call('POST', '/detect', payload),
      init: (payload) => call('POST', '/init', payload),
      models: () => call('GET', '/models'),
      action: (root, op, args) => call('POST', '/action', { root, op, args }),
      list: (path) => call('GET', '/fs/list', { path: path || '' }),
      pick: () => call('POST', '/fs/pick', {}),
      mkdir: (path, name) => call('POST', '/fs/mkdir', { path, name }),
      places: (cwd) => call('GET', '/fs/places', { cwd: cwd || undefined }),
      bind: (payload) => call('POST', '/bind', payload),
      activity: (root, task) => call('GET', '/activity', { root, task: task || undefined }),
      evidence: (root, id) => call('GET', '/evidence', { root, id }),
      gitRepo: (url) => call('GET', '/git/repo', { url }),
      gitClone: (payload) => call('POST', '/git/clone', payload),
    }

    // ───────────── 样式（主题令牌） ─────────────
    const CSS = `
.rk{position:relative;height:100%;display:flex;flex-direction:column;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.55;background:var(--dsw-alias-bg-layer-1)}
.rk *{box-sizing:border-box}
.rk-head{padding:10px 14px 0;border-bottom:1px solid var(--dsw-alias-border-l2)}
.rk-title{display:flex;align-items:baseline;gap:8px;font-weight:600;font-size:14px}
.rk-sub{color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:400;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rk-tabs{display:flex;gap:2px;margin-top:8px;overflow-x:auto}
.rk-tab{border:0;background:transparent;color:var(--dsw-alias-label-secondary);padding:6px 10px;border-radius:6px 6px 0 0;cursor:pointer;font:inherit;white-space:nowrap}
.rk-tab:hover{background:var(--dsw-alias-interactive-bg-hover)}
.rk-tab.on{color:var(--dsw-alias-label-primary);font-weight:600;box-shadow:inset 0 -2px 0 var(--dsw-alias-brand-primary)}
.rk-badge{display:inline-block;min-width:16px;padding:0 5px;margin-left:4px;border-radius:999px;font-size:11px;line-height:16px;text-align:center;background:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-label-primary-inverted)}
.rk-body{flex:1;overflow:auto;padding:12px 14px 24px}
.rk-sec{margin-bottom:16px}
.rk-h{font-size:13px;font-weight:600;margin:0 0 8px}
.rk-card{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:10px 12px;margin-bottom:10px;background:var(--dsw-alias-bg-layer-2)}
.rk-card.alert{border-color:var(--dsw-alias-state-warn-primary)}
.rk-muted{color:var(--dsw-alias-label-tertiary)}
.rk-err{color:var(--dsw-alias-state-error-primary);white-space:pre-wrap}
.rk-ok{color:var(--dsw-alias-state-success-primary)}
.rk-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.rk-grow{flex:1;min-width:0}
.rk-btn{border:1px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);padding:4px 10px;border-radius:6px;cursor:pointer;font:inherit;font-size:12px}
.rk-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.rk-btn:disabled{opacity:.5;cursor:default}
.rk-btn.primary{background:var(--dsw-alias-button-primary-fill);border-color:transparent;color:var(--dsw-alias-label-primary-foreground)}
.rk-btn.primary:hover{background:var(--dsw-alias-button-primary-hover)}
.rk-btn.danger{color:var(--dsw-alias-state-error-primary)}
.rk-in,.rk-sel,.rk-ta{width:100%;border:1px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:6px;padding:4px 8px;font:inherit;font-size:12px}
.rk-ta{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;min-height:120px;resize:vertical}
.rk-lbl{display:block;font-size:12px;color:var(--dsw-alias-label-secondary);margin:8px 0 3px}
.rk-hint{font-size:11px;color:var(--dsw-alias-label-tertiary);margin-top:2px}
.rk-tbl{width:100%;border-collapse:collapse;font-size:12px}
.rk-tbl th,.rk-tbl td{text-align:left;padding:4px 6px;border-bottom:1px solid var(--dsw-alias-border-l1);vertical-align:top}
.rk-tbl th{color:var(--dsw-alias-label-tertiary);font-weight:600}
.rk-pill{display:inline-block;padding:0 7px;border-radius:999px;font-size:11px;border:1px solid currentColor}
.rk-pill.ok{color:var(--dsw-alias-state-success-primary)}.rk-pill.bad{color:var(--dsw-alias-state-error-primary)}
.rk-pill.warn{color:var(--dsw-alias-state-warn-primary)}.rk-pill.info{color:var(--dsw-alias-state-business-primary)}.rk-pill.mute{color:var(--dsw-alias-label-tertiary)}
.rk-kpis{display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:8px}
.rk-kpi{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 8px}
.rk-kpi b{display:block;font-size:17px}.rk-kpi span{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.rk-md table{border-collapse:collapse;margin:6px 0;font-size:12px}.rk-md td,.rk-md th{border:1px solid var(--dsw-alias-border-l2);padding:3px 6px}
.rk-md p{margin:4px 0}.rk-md code{background:var(--dsw-alias-markdown-inline-code);padding:0 3px;border-radius:3px;font-size:12px}
.rk-md pre{background:var(--dsw-alias-markdown-code-block);padding:6px 8px;border-radius:6px;overflow:auto;font-size:12px}
.rk-toast{position:sticky;bottom:0;margin-top:8px;padding:6px 10px;border-radius:6px;background:var(--dsw-alias-toast-bg);color:var(--dsw-alias-toast-label);font-size:12px}
.rk-grid2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.rk-sep{height:1px;background:var(--dsw-alias-border-l1);margin:12px 0}
.rk-proj{display:grid;grid-template-columns:auto 1fr;gap:2px 8px;font-size:12px;margin-top:6px}
.rk-proj>span:nth-child(odd){color:var(--dsw-alias-label-tertiary)}
.rk-path{font-family:ui-monospace,Consolas,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rk-dirs{max-height:260px;overflow:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;margin:6px 0}
.rk-dir{display:block;width:100%;text-align:left;border:0;background:transparent;color:var(--dsw-alias-label-primary);padding:4px 8px;font:inherit;font-size:12px;cursor:pointer}
.rk-dir:hover{background:var(--dsw-alias-interactive-bg-hover)}
.rk-tl{position:relative;padding-left:18px}
.rk-tl:before{content:"";position:absolute;left:6px;top:4px;bottom:4px;width:1px;background:var(--dsw-alias-border-l2)}
.rk-ev{position:relative;margin-bottom:10px}
.rk-dot{position:absolute;left:-16px;top:5px;width:9px;height:9px;border-radius:50%;background:var(--dsw-alias-label-tertiary)}
.rk-dot.ok{background:var(--dsw-alias-state-success-primary)}.rk-dot.bad{background:var(--dsw-alias-state-error-primary)}.rk-dot.warn{background:var(--dsw-alias-state-warn-primary)}
.rk-dot.human,.rk-dot.open{background:var(--dsw-alias-state-business-primary)}.rk-dot.agent,.rk-dot.skill{background:var(--dsw-alias-brand-primary)}
.rk-pre{white-space:pre-wrap;word-break:break-all;font-family:ui-monospace,Consolas,monospace;font-size:11px;max-height:320px;overflow:auto;background:var(--dsw-alias-markdown-code-block);padding:8px;border-radius:6px}
.rk-link{border:0;background:none;padding:0;color:var(--dsw-alias-link);cursor:pointer;font:inherit;font-size:12px}
.rk-modal{position:absolute;inset:0;z-index:20;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.45));display:flex;align-items:center;justify-content:center;padding:12px}
.rk-dlg{width:100%;max-width:720px;max-height:100%;display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l3);border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.35);overflow:hidden}
.rk-dlg-head{display:flex;align-items:center;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l2);font-size:14px}
.rk-x{border:0;background:transparent;color:var(--dsw-alias-label-secondary);font-size:18px;cursor:pointer;padding:0 4px;line-height:1}
.rk-x:hover{color:var(--dsw-alias-label-primary)}
.rk-dlg-bar{display:flex;gap:6px;align-items:center;padding:8px 12px 0}
.rk-crumbs{display:flex;flex-wrap:wrap;align-items:center;gap:2px;min-width:0;flex:1}
.rk-crumb{border:0;background:transparent;color:var(--dsw-alias-label-primary);padding:2px 6px;border-radius:5px;cursor:pointer;font:inherit;font-size:12px}
.rk-crumb:hover{background:var(--dsw-alias-interactive-bg-hover)}
.rk-places{display:flex;gap:6px;overflow-x:auto;padding:8px 12px 0}
.rk-place{flex-shrink:0;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:2px 10px;font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}
.rk-place:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.rk-dlg-list{flex:1;min-height:180px;overflow:auto;margin:8px 12px 0;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}
.rk-dlg-list .rk-dir{display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.rk-dir-ic{width:18px;text-align:center}
.rk-newdir{display:flex;align-items:center;gap:6px;padding:6px 10px;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2)}
.rk-dlg-sel{display:flex;align-items:center;gap:6px;padding:8px 12px;font-size:12px;min-width:0}
.rk-dlg-foot{display:flex;align-items:center;gap:8px;padding:10px 12px;border-top:1px solid var(--dsw-alias-border-l2);flex-wrap:wrap}
.rk-pathfield{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:10px 12px;margin-top:10px;background:var(--dsw-alias-bg-layer-1)}
.rk-pathfield .rk-pill{margin-left:4px}
.rk-mono{font-family:ui-monospace,Consolas,monospace}
.rk-arrow{text-align:center;color:var(--dsw-alias-label-tertiary);margin:4px 0 -4px;font-size:14px}
`

    // 输入框下方按钮（与 cost-meter 的"费用明细"同款样式），单独注入，面板未打开时也生效
    const DOCK_CSS = `
.rk-dock-btn{font:inherit;font-size:12px;line-height:20px;padding:0 6px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-button-elevated-fill);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;cursor:pointer;white-space:nowrap;flex-shrink:0}
.rk-dock-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.rk-dock-btn .rk-dock-n{display:inline-block;min-width:16px;padding:0 5px;margin-left:4px;border-radius:999px;font-size:11px;line-height:16px;text-align:center;background:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-label-primary-inverted)}
`

    // ───────────── 小组件 ─────────────
    function inline(text, keyBase) {
      const parts = String(text).split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
      return parts.map((p, i) => {
        if (p.startsWith('**') && p.endsWith('**')) return h('b', { key: keyBase + i }, p.slice(2, -2))
        if (p.startsWith('`') && p.endsWith('`')) return h('code', { key: keyBase + i }, p.slice(1, -1))
        return p
      })
    }

    /** 极简 Markdown：表格、标题、列表、代码块、粗体与行内代码。 */
    function Md({ text }) {
      const lines = String(text || '').split(/\r?\n/)
      const out = []
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i]
        if (l.startsWith('```')) {
          const buf = []
          i++
          while (i < lines.length && !lines[i].startsWith('```')) buf.push(lines[i++])
          out.push(h('pre', { key: i }, buf.join('\n')))
        } else if (l.trim().startsWith('|')) {
          const rows = []
          while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(lines[i++])
          i--
          const cells = rows.filter((r) => !/^\s*\|\s*-/.test(r)).map((r) => r.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|')))
          out.push(h('table', { key: i }, h('tbody', null, cells.map((r, ri) => h('tr', { key: ri }, r.map((c, ci) => h(ri === 0 ? 'th' : 'td', { key: ci }, inline(c, ri + '-' + ci + '-'))))))))
        } else if (/^#{1,4}\s/.test(l)) {
          out.push(h('p', { key: i }, h('b', null, l.replace(/^#+\s/, ''))))
        } else if (/^\s*[-*]\s/.test(l)) {
          out.push(h('p', { key: i }, '• ', inline(l.replace(/^\s*[-*]\s/, ''), i + '-')))
        } else if (l.trim() === '---') {
          out.push(h('div', { key: i, className: 'rk-sep' }))
        } else if (l.trim() !== '') {
          out.push(h('p', { key: i }, inline(l, i + '-')))
        }
      }
      return h('div', { className: 'rk-md' }, out)
    }

    const pct = (x) => ((Number(x) || 0) * 100).toFixed(1) + '%'
    const KIND = { DONE: 'ok', OPEN: 'info', BLOCKED: 'bad', ABANDONED: 'mute', covered: 'ok', partial: 'warn', missing: 'bad', retired: 'mute', unknown: 'mute', pass: 'ok', fail: 'bad', pending: 'warn' }
    const Pill = ({ v }) => h('span', { className: 'rk-pill ' + (KIND[v] || 'mute') }, v)
    const Field = ({ label, hint, children }) => h('div', null, h('label', { className: 'rk-lbl' }, label), children, hint ? h('div', { className: 'rk-hint' }, hint) : null)
    const lines = (arr) => (arr || []).join('\n')
    const unlines = (s) => String(s || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean)

    // ───────────── 待审核 ─────────────
    function ReviewCard({ item, onDone, notify }) {
      const original = item.editable ? item.editable.text : ''
      const [text, setText] = useState(original)
      const [comment, setComment] = useState('')
      const [busy, setBusy] = useState(false)
      const send = async (payload) => {
        setBusy(true)
        try {
          await api.review(Object.assign({ id: item.id }, payload))
          notify(item.header + '：已提交')
          onDone()
        } catch (e) { notify(e.message, true) } finally { setBusy(false) }
      }
      const edited = item.editable && text !== original
      const approve = () => send(edited ? { outcome: 'approved-with-changes', edited: text, comment: comment || undefined } : { outcome: 'approved', comment: comment || undefined })
      return h('div', { className: 'rk-card alert' },
        h('div', { className: 'rk-row' }, h('b', { className: 'rk-grow' }, item.header + (item.taskId ? ' · ' + item.taskId : '')), h('span', { className: 'rk-muted' }, (item.createdAt || '').slice(11, 19))),
        h('p', null, item.question),
        h(Md, { text: item.detail }),
        item.editable ? h(Field, { label: '可编辑：rk-' + item.editable.block, hint: '直接修改后点「通过」即按修改后的内容执行（同步写回 ' + item.file + '）' },
          h('textarea', { className: 'rk-ta', value: text, onChange: (e) => setText(e.target.value), spellCheck: false })) : null,
        h(Field, { label: '意见（可选；驳回或提意见时必填）' }, h('input', { className: 'rk-in', value: comment, onChange: (e) => setComment(e.target.value), placeholder: '例如：A1 改用具体测试类' })),
        h('div', { className: 'rk-row', style: { marginTop: 8 } },
          item.custom
            ? item.options.map((o, i) => h('button', { key: o.label, className: 'rk-btn' + (i === 0 ? ' primary' : ''), disabled: busy, title: o.description, onClick: () => send({ outcome: comment ? 'feedback' : 'approved', selected: o.label, comment: comment || undefined }) }, o.label))
            : [
                h('button', { key: 'a', className: 'rk-btn primary', disabled: busy, onClick: approve }, edited ? '修改后通过' : '通过'),
                h('button', { key: 'f', className: 'rk-btn', disabled: busy || !comment.trim(), onClick: () => send({ outcome: 'feedback', comment }) }, '提意见退回'),
                h('button', { key: 'r', className: 'rk-btn danger', disabled: busy, onClick: () => send({ outcome: 'rejected', comment: comment || undefined }) }, '驳回'),
              ]),
        h('div', { className: 'rk-hint' }, '审核文件：' + item.file))
    }

    function ReviewsView({ state, root, refresh, notify }) {
      const pending = state.pending || []
      const notes = state.notes || []
      return h('div', null,
        h('div', { className: 'rk-sec' },
          h('div', { className: 'rk-h' }, '等待你决定（' + pending.length + '）'),
          pending.length === 0 ? h('p', { className: 'rk-muted' }, '没有阻塞中的审核。模型推进到需要你签字的节点时，会出现在这里，面板会自动打开。') : null,
          pending.map((item) => h(ReviewCard, { key: item.id, item, onDone: refresh, notify }))),
        h('div', { className: 'rk-sec' },
          h('div', { className: 'rk-h' }, '待阅材料（' + notes.length + '，不阻塞）'),
          notes.length === 0 ? h('p', { className: 'rk-muted' }, '无') : null,
          notes.map((n) => h('div', { className: 'rk-card', key: (n.taskId || 'p') + n.index },
            h('div', { className: 'rk-row' },
              h('b', { className: 'rk-grow' }, n.checkpoint + (n.taskId ? ' · ' + n.taskId : ' · 项目')),
              h('button', { className: 'rk-btn', onClick: async () => { try { await api.ack({ root, taskId: n.taskId, index: n.index }); refresh() } catch (e) { notify(e.message, true) } } }, '已阅')),
            h('div', { className: 'rk-hint' }, n.file + ' · ' + String(n.askedAt || '').replace('T', ' ').slice(0, 16))))))
    }

    // ───────────── 概览 ─────────────
    function OverviewView({ state, root, refresh, notify }) {
      const [busy, setBusy] = useState('')
      const run = async (op, label) => {
        setBusy(op)
        try { const r = await api.action(root, op, {}); notify(r.message || label + '完成'); refresh() } catch (e) { notify(e.message, true) } finally { setBusy('') }
      }
      const s = state.status || {}
      const g = state.gapSummary
      const kpi = (v, l) => h('div', { className: 'rk-kpi', key: l }, h('b', null, v), h('span', null, l))
      return h('div', null,
        h('div', { className: 'rk-sec' },
          h('div', { className: 'rk-row' }, h('span', { className: 'rk-grow' }, '状态：', h(Pill, { v: s.state || '-' })), h('span', { className: 'rk-muted' }, '审核预设 ' + state.preset)),
          h('div', { className: 'rk-row', style: { marginTop: 8 } },
            h('button', { className: 'rk-btn', disabled: !!busy, onClick: () => run('survey', '盘点') }, busy === 'survey' ? '盘点中…' : '盘点新旧仓库'),
            h('button', { className: 'rk-btn', disabled: !!busy || !state.survey, onClick: () => run('gaps', '刷新缺口') }, busy === 'gaps' ? '计算中…' : '刷新缺口'),
            h('button', { className: 'rk-btn', disabled: !!busy, onClick: () => run('report', '看板') }, '生成看板'))),
        g ? h('div', { className: 'rk-sec' }, h('div', { className: 'rk-kpis' },
          kpi(g.total, '缺口'), kpi(g.missing, '缺失'), kpi(g.partial, '部分'), kpi(g.covered, '已覆盖'), kpi(g.retired, '已裁撤'), kpi(pct(g.endpointCoverage), '端点覆盖（估算）'),
          state.survey ? kpi(pct(state.survey.weighted), '文件数加权') : null)) : null,
        h('div', { className: 'rk-sec' }, h('div', { className: 'rk-h' }, '下一步'), (s.nextSteps || []).map((x, i) => h('p', { key: i }, '• ' + x))),
        h('div', { className: 'rk-sec' }, h('div', { className: 'rk-h' }, '任务'),
          (state.tasks || []).length === 0 ? h('p', { className: 'rk-muted' }, '还没有任务。在对话中说"把缺口 X 做完"，模型会写契约并提交审核。') : null,
          (state.tasks || []).map((t) => h('div', { key: t.id, className: 'rk-row' }, h(Pill, { v: t.status }), h('span', { className: 'rk-grow' }, t.id + ' ' + t.title), h('span', { className: 'rk-muted' }, (t.risk && t.risk.level) || (t.riskEstimate && t.riskEstimate.level + '(预估)') || '')))),
        (state.memory || []).length ? h('div', { className: 'rk-sec' }, h('div', { className: 'rk-h' }, '项目记忆'), state.memory.map((m, i) => h('p', { key: i, className: 'rk-muted' }, m))) : null)
    }

    // ───────────── 缺口 ─────────────
    function GapRow({ g, root, controllers, refresh, notify }) {
      const [mode, setMode] = useState('')
      const [val, setVal] = useState('')
      const act = async (op, args, done) => {
        try { const r = await api.action(root, op, args); notify(r.message); setMode(''); refresh() } catch (e) { notify(e.message, true) }
      }
      return h(React.Fragment, null,
        h('tr', null,
          h('td', null, g.id, g.note ? h('div', { className: 'rk-hint' }, g.note) : null),
          h('td', null, g.estMatched + '/' + g.endpoints),
          h('td', null, pct(g.coverage)),
          h('td', null, h(Pill, { v: g.status })),
          h('td', null, g.basis, h('div', { className: 'rk-hint' }, (g.mappedTo || []).join(', ') || '—')),
          h('td', null, h('div', { className: 'rk-row' },
            h('button', { className: 'rk-btn', onClick: () => { setMode('map'); setVal((g.mappedTo || []).join(', ')) } }, '对应'),
            g.status === 'retired'
              ? h('button', { className: 'rk-btn', onClick: () => act('unretire', { ids: [g.id] }) }, '撤销裁撤')
              : h('button', { className: 'rk-btn', onClick: () => { setMode('retire'); setVal('') } }, '裁撤')))),
        mode ? h('tr', null, h('td', { colSpan: 6 },
          mode === 'map'
            ? h('div', null,
                h('div', { className: 'rk-hint' }, '老类 ' + g.className + ' 在新系统中对应的控制器（逗号分隔；留空表示"新系统没有对应"）'),
                h('input', { className: 'rk-in', list: 'rk-ctl-list', value: val, onChange: (e) => setVal(e.target.value) }),
                h('div', { className: 'rk-row', style: { marginTop: 6 } },
                  h('button', { className: 'rk-btn primary', onClick: () => act('mapping', { className: g.className, targets: val.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean) }) }, '保存对应'),
                  h('button', { className: 'rk-btn', onClick: () => act('mapping', { className: g.className }) }, '恢复自动匹配'),
                  h('button', { className: 'rk-btn', onClick: () => setMode('') }, '取消')))
            : h('div', null,
                h('div', { className: 'rk-hint' }, '裁撤会把它从完成度分母中移除。请写明理由（如：技术已淘汰、被新机制替代）。'),
                h('input', { className: 'rk-in', value: val, onChange: (e) => setVal(e.target.value), placeholder: '裁撤理由' }),
                h('div', { className: 'rk-row', style: { marginTop: 6 } },
                  h('button', { className: 'rk-btn primary', disabled: !val.trim(), onClick: () => act('retire', { ids: [g.id], reason: val }) }, '确认裁撤'),
                  h('button', { className: 'rk-btn', onClick: () => setMode('') }, '取消'))))) : null)
    }

    function GapsView({ state, root, refresh, notify }) {
      const [status, setStatus] = useState('open')
      const [q, setQ] = useState('')
      const list = useMemo(() => (state.gaps || [])
        .filter((g) => status === 'all' ? true : status === 'open' ? (g.status === 'missing' || g.status === 'partial') : g.status === status)
        .filter((g) => !q || g.id.toLowerCase().includes(q.toLowerCase()) || (g.mappedTo || []).join(' ').toLowerCase().includes(q.toLowerCase()))
        .sort((a, b) => (b.endpoints || 0) - (a.endpoints || 0)), [state.gaps, status, q])
      if (!state.gaps || state.gaps.length === 0) return h('p', { className: 'rk-muted' }, '还没有缺口清单。到「概览」点「盘点新旧仓库」，再点「刷新缺口」。')
      return h('div', null,
        h('datalist', { id: 'rk-ctl-list' }, (state.targetControllers || []).map((c) => h('option', { key: c, value: c }))),
        h('div', { className: 'rk-row', style: { marginBottom: 8 } },
          h('select', { className: 'rk-sel', style: { width: 'auto' }, value: status, onChange: (e) => setStatus(e.target.value) },
            [['open', '未覆盖（缺失+部分）'], ['all', '全部'], ['missing', '缺失'], ['partial', '部分'], ['covered', '已覆盖'], ['retired', '已裁撤']].map(([v, l]) => h('option', { key: v, value: v }, l))),
          h('input', { className: 'rk-in rk-grow', placeholder: '搜索缺口或新类名', value: q, onChange: (e) => setQ(e.target.value) })),
        h('p', { className: 'rk-hint' }, '依据：name / alias 是按类名推断的对应关系，请核对；不对的点「对应」改正。覆盖率对 name / alias / mapping 为按端点数估算。'),
        h('table', { className: 'rk-tbl' },
          h('thead', null, h('tr', null, ['缺口', '端点', '覆盖', '状态', '依据 / 对应', ''].map((x) => h('th', { key: x }, x)))),
          h('tbody', null, list.slice(0, 200).map((g) => h(GapRow, { key: g.id, g, root, refresh, notify })))),
        list.length > 200 ? h('p', { className: 'rk-hint' }, '仅显示前 200 条，请用筛选或搜索缩小范围。') : null)
    }

    // ───────────── 任务 ─────────────
    function TasksView({ state }) {
      const [open, setOpen] = useState('')
      const tasks = state.tasks || []
      if (tasks.length === 0) return h('p', { className: 'rk-muted' }, '还没有任务。')
      return h('div', null, tasks.slice().reverse().map((t) => {
        const isOpen = open === t.id
        return h('div', { key: t.id, className: 'rk-card' },
          h('div', { className: 'rk-row', style: { cursor: 'pointer' }, onClick: () => setOpen(isOpen ? '' : t.id) },
            h(Pill, { v: t.status }), h('b', { className: 'rk-grow' }, t.id + ' ' + t.title),
            h('span', { className: 'rk-muted' }, ((t.risk && t.risk.level) || (t.riskEstimate && t.riskEstimate.level) || '') + ' ' + (isOpen ? '▾' : '▸'))),
          isOpen ? h('div', null,
            h('div', { className: 'rk-h', style: { marginTop: 8 } }, '契约与证据'),
            h('table', { className: 'rk-tbl' }, h('tbody', null, t.contract.map((a) => {
              const r = (t.results || {})[a.id]
              return h('tr', { key: a.id }, h('td', null, a.id), h('td', null, a.statement, h('div', { className: 'rk-hint' }, a.check.gate ? 'gate: ' + a.check.gate : a.check.command)),
                h('td', null, r ? h(Pill, { v: r.verdict }) : h('span', { className: 'rk-muted' }, '未执行')),
                h('td', { className: 'rk-hint' }, r ? (r.evidenceId + ' · exit ' + (r.exitCode == null ? '-' : r.exitCode) + (r.exec !== 'ran' ? ' · ' + r.exec : '')) : ''))
            }))),
            (t.reviews || []).length ? h('div', null, h('div', { className: 'rk-h', style: { marginTop: 8 } }, '异源审查'),
              t.reviews.map((r, i) => h('p', { key: i }, h(Pill, { v: r.verdict === 'pass' ? 'pass' : 'fail' }), ' ' + r.reviewer.provider + '/' + r.reviewer.model + ' · ' + (r.findings || []).length + ' 个问题'))) : null,
            (t.closeAttempts || []).length ? h('div', null, h('div', { className: 'rk-h', style: { marginTop: 8 } }, '最近一次关闭被拒'),
              (t.closeAttempts[t.closeAttempts.length - 1].missing || []).map((m, i) => h('p', { key: i, className: 'rk-err' }, m))) : null,
            (t.humanReviews || []).length ? h('div', null, h('div', { className: 'rk-h', style: { marginTop: 8 } }, '人工审核记录'),
              t.humanReviews.map((r, i) => h('p', { key: i, className: 'rk-muted' }, r.checkpoint + ' · ' + r.policy + ' → ' + r.outcome + (r.comment ? '：' + r.comment : '')))) : null) : null)
      }))
    }

    // ───────────── 配置表单（初始化与修改共用） ─────────────
    function ModelPick({ value, onChange, catalog }) {
      const v = value || {}
      const prov = catalog.find((p) => p.provider === v.provider)
      return h('div', { className: 'rk-grid2' },
        h('select', { className: 'rk-sel', value: v.provider || '', onChange: (e) => onChange({ provider: e.target.value, model: '' }) },
          h('option', { value: '' }, '— provider —'),
          catalog.map((p) => h('option', { key: p.provider, value: p.provider }, p.label)),
          v.provider && !prov ? h('option', { value: v.provider }, v.provider + '（未在 DSH 中找到）') : null),
        prov && prov.models.length
          ? h('select', { className: 'rk-sel', value: v.model || '', onChange: (e) => onChange(Object.assign({}, v, { model: e.target.value })) },
              h('option', { value: '' }, '— 模型 —'),
              prov.models.map((m) => h('option', { key: m.id, value: m.id }, m.name === m.id ? m.id : m.name + '（' + m.id + '）')),
              v.model && !prov.models.some((m) => m.id === v.model) ? h('option', { value: v.model }, v.model) : null)
          : h('input', { className: 'rk-in', placeholder: '模型 id', value: v.model || '', onChange: (e) => onChange(Object.assign({}, v, { model: e.target.value })) }))
    }

    function ConfigForm({ initial, catalog, onSave, saveLabel, extraTop }) {
      const [c, setC] = useState(() => JSON.parse(JSON.stringify(initial)))
      const [busy, setBusy] = useState(false)
      const [err, setErr] = useState('')
      const [advanced, setAdvanced] = useState(false)
      const set = (path, value) => setC((prev) => {
        const next = JSON.parse(JSON.stringify(prev))
        let o = next
        for (let i = 0; i < path.length - 1; i++) o = o[path[i]] = o[path[i]] || {}
        if (value === undefined) delete o[path[path.length - 1]]; else o[path[path.length - 1]] = value
        return next
      })
      const slots = c.slots || {}
      const slotOf = (name) => { const s = slots[name]; return s && !s.candidates ? s : undefined }
      const reviewers = (slots.reviewer && slots.reviewer.candidates) || (slots.reviewer && slots.reviewer.provider ? [slots.reviewer] : [])
      const gates = Object.entries(c.gates || {})
      const setGate = (oldName, name, g) => setC((prev) => {
        const next = JSON.parse(JSON.stringify(prev))
        const entries = Object.entries(next.gates || {}).map(([n, v]) => n === oldName ? [name, g] : [n, v])
        next.gates = Object.fromEntries(entries.filter(([n]) => n))
        return next
      })
      const byModel = Object.entries((c.autonomy && c.autonomy.byModel) || {}).map(([k, v]) => k + ': ' + v).join('\n')
      const save = async () => {
        setBusy(true); setErr('')
        try {
          const next = JSON.parse(JSON.stringify(c))
          // 空门禁行（没填命令）直接丢弃，不再报错挡保存；代码项目才需要门禁
          if (next.gates) next.gates = Object.fromEntries(Object.entries(next.gates).filter(([, g]) => g && g.command && g.command.trim()))
          await onSave(next)
        } catch (e) { setErr(e.message) } finally { setBusy(false) }
      }
      return h('div', null,
        extraTop || null,
        h('div', { className: 'rk-sec' }, h('div', { className: 'rk-h' }, '项目'),
          h(Field, { label: '项目名称' }, h('input', { className: 'rk-in', value: (c.project && c.project.name) || '', onChange: (e) => set(['project', 'name'], e.target.value) })),
          h(Field, { label: '老系统仓库（只读）', hint: '插件会拦截对它的任何写入' }, h('input', { className: 'rk-in', value: (c.project && c.project.legacyRoot) || '', onChange: (e) => set(['project', 'legacyRoot'], e.target.value) })),
          h(Field, { label: '允许写入的目录（每行一个 glob）', hint: '范围外的写入会被拦截' }, h('textarea', { className: 'rk-ta', style: { minHeight: 70 }, value: lines(c.project && c.project.writeScope), onChange: (e) => set(['project', 'writeScope'], unlines(e.target.value)) })),
          h(Field, { label: '记忆文件（每行一个，可空）', hint: '项目索引、词汇表等，会话开始时注入摘要' }, h('textarea', { className: 'rk-ta', style: { minHeight: 50 }, value: lines(c.project && c.project.memoryFiles), onChange: (e) => set(['project', 'memoryFiles'], unlines(e.target.value)) }))),
        h('button', { type: 'button', className: 'rk-link', style: { marginBottom: 8 }, onClick: () => setAdvanced(!advanced) }, advanced ? '▲ 收起高级设置' : '▾ 高级设置（模型、门禁、审核密度，可选）'),
        advanced ? h(React.Fragment, null,
        h('div', { className: 'rk-sec' }, h('div', { className: 'rk-h' }, '模型槽'),
          h('p', { className: 'rk-hint', style: { marginTop: 2 } }, '模型槽用于指定分身/审查用哪家模型。留空或选「— provider —」= 沿用当前会话正在用的模型，一般不需要改。'),
          catalog.length === 0 ? h('p', { className: 'rk-hint' }, '未读到 DSH 的模型目录，可以直接填写 provider 与模型 id。') : null,
          h(Field, { label: 'fast：读旧代码、摘要（便宜快速）' }, h(ModelPick, { value: slotOf('fast'), catalog, onChange: (v) => set(['slots', 'fast'], v) })),
          h(Field, { label: 'strong：架构决策（强推理）' }, h(ModelPick, { value: slotOf('strong'), catalog, onChange: (v) => set(['slots', 'strong'], v) })),
          h(Field, { label: 'reviewer：异源审查候选（按顺序选第一个与实施者不同来源的）' },
            reviewers.map((r, i) => h('div', { key: i, className: 'rk-row', style: { marginBottom: 4 } },
              h('div', { className: 'rk-grow' }, h(ModelPick, { value: r, catalog, onChange: (v) => { const list = reviewers.slice(); list[i] = v; set(['slots', 'reviewer'], { candidates: list }) } })),
              h('button', { className: 'rk-btn danger', onClick: () => set(['slots', 'reviewer'], { candidates: reviewers.filter((_, j) => j !== i) }) }, '删除'))),
            h('button', { className: 'rk-btn', onClick: () => set(['slots', 'reviewer'], { candidates: reviewers.concat([{ provider: '', model: '' }]) }) }, '+ 添加审查候选'))),
        h('div', { className: 'rk-sec' }, h('div', { className: 'rk-h' }, '审核与自主度'),
          h('div', { className: 'rk-grid2' },
            h(Field, { label: '审核预设' }, h('select', { className: 'rk-sel', value: (c.review && c.review.preset) || 'standard', onChange: (e) => set(['review', 'preset'], e.target.value) },
              h('option', { value: 'strict' }, 'strict：每个审核点都等我'), h('option', { value: 'standard' }, 'standard：高风险等我（默认）'), h('option', { value: 'light' }, 'light：只在关键处等我'))),
            h(Field, { label: '审核方式' }, h('select', { className: 'rk-sel', value: (c.review && c.review.ui) || 'auto', onChange: (e) => set(['review', 'ui'], e.target.value) },
              h('option', { value: 'auto' }, 'auto：面板打开时用面板'), h('option', { value: 'panel' }, 'panel：总是用面板'), h('option', { value: 'card' }, 'card：问答卡'))),
            h(Field, { label: '默认自主度' }, h('select', { className: 'rk-sel', value: (c.autonomy && c.autonomy.default) || 'assisted', onChange: (e) => set(['autonomy', 'default'], e.target.value) },
              h('option', { value: 'free' }, 'free：只守底线'), h('option', { value: 'assisted' }, 'assisted：给建议'), h('option', { value: 'guided' }, 'guided：逐步引导')))),
          h(Field, { label: '按模型的自主度（每行 "provider/model模式: 档位"）', hint: '例：anthropic/claude-opus-*: free' },
            h('textarea', { className: 'rk-ta', style: { minHeight: 50 }, value: byModel, onChange: (e) => set(['autonomy', 'byModel'], Object.fromEntries(unlines(e.target.value).map((l) => { const i = l.lastIndexOf(':'); return [l.slice(0, i).trim().replace(/^"|"$/g, ''), l.slice(i + 1).trim()] }).filter(([k, v]) => k && v))) }))),
        h('div', { className: 'rk-sec' }, h('div', { className: 'rk-h' }, '门禁（契约断言可引用）'),
          h('p', { className: 'rk-hint', style: { marginTop: 2 } }, '门禁是可选的检查命令（如 mvn test、pnpm build）。你的项目如果是提示词/文档等没有构建产物的迁移，可以全部留空或直接「删」，直接保存即可。'),
          h('table', { className: 'rk-tbl' },
            h('thead', null, h('tr', null, ['名称', '命令', '目录', '期望输出', '副作用', ''].map((x) => h('th', { key: x }, x)))),
            h('tbody', null, gates.map(([name, g]) => h('tr', { key: name },
              h('td', null, h('input', { className: 'rk-in', defaultValue: name, onBlur: (e) => e.target.value !== name && setGate(name, e.target.value.trim(), g) })),
              h('td', null, h('input', { className: 'rk-in', value: g.command || '', onChange: (e) => setGate(name, name, Object.assign({}, g, { command: e.target.value })) })),
              h('td', null, h('input', { className: 'rk-in', value: g.cwd || '', onChange: (e) => setGate(name, name, Object.assign({}, g, { cwd: e.target.value || undefined })) })),
              h('td', null, h('input', { className: 'rk-in', value: g.expectPattern || '', onChange: (e) => setGate(name, name, Object.assign({}, g, { expectPattern: e.target.value || undefined })) })),
              h('td', null, h('input', { type: 'checkbox', checked: !!g.sideEffect, onChange: (e) => setGate(name, name, Object.assign({}, g, { sideEffect: e.target.checked || undefined })) })),
              h('td', null, h('button', { className: 'rk-btn danger', onClick: () => setGate(name, '', g) }, '删')))))),
          h('div', { className: 'rk-row', style: { marginTop: 6 } },
            h('button', { className: 'rk-btn', onClick: () => set(['gates', 'gate' + (gates.length + 1)], { command: '' }) }, '+ 添加门禁'),
            h('button', { className: 'rk-btn', onClick: () => set(['commandAllowlist'], Array.from(new Set((c.commandAllowlist || []).concat(gates.map(([, g]) => g.command).filter(Boolean))))) }, '把门禁命令加入白名单'))),
        h('div', { className: 'rk-sec' }, h('div', { className: 'rk-h' }, '命令白名单'),
          h(Field, { label: '门禁与断言只能执行这些前缀（每行一个）' }, h('textarea', { className: 'rk-ta', style: { minHeight: 80 }, value: lines(c.commandAllowlist), onChange: (e) => set(['commandAllowlist'], unlines(e.target.value)) }))),
        ) : null,
        h('div', { className: 'rk-row' },
          h('button', { className: 'rk-btn primary', disabled: busy, onClick: save }, busy ? '保存中…' : saveLabel)),
        err ? h('p', { className: 'rk-err' }, err) : null)
    }

    function ConfigView({ root, catalog, notify, refresh }) {
      const [data, setData] = useState(null)
      const [err, setErr] = useState('')
      const [ver, setVer] = useState(0)
      useEffect(() => { api.config(root).then(setData, (e) => setErr(e.message)) }, [root, ver])
      if (err) return h('p', { className: 'rk-err' }, err)
      if (!data) return h('p', { className: 'rk-muted' }, '读取配置…')
      if (!data.valid) return h('div', null, h('p', { className: 'rk-err' }, data.error), h('p', { className: 'rk-hint' }, '配置文件有错误，请在 ' + data.file + ' 中修正后点刷新。'), h('button', { className: 'rk-btn', onClick: () => setVer(ver + 1) }, '刷新'))
      return h(ConfigForm, {
        key: ver, initial: data.config, catalog, saveLabel: '保存配置',
        extraTop: h('p', { className: 'rk-hint' }, '配置文件：' + data.file + '（只改动表单中的字段，保留其他内容与注释）'),
        onSave: async (c) => { await api.saveConfig(root, c); notify('配置已保存'); setVer(ver + 1); refresh() },
      })
    }

    // ───────────── 目录选择 ─────────────
    let clientCtx = null
    const setClientCtx = (c) => { clientCtx = c }

    /**
     * 打开系统文件夹对话框。返回所选路径；取消返回 null；当前环境不支持返回 undefined。
     * 1) macOS Desktop：preload 暴露的 __DSH_DIRECTORY_PICKER__；
     * 2) Windows / Linux Desktop 与本机 Web：官方 uiWorkspace.pickDirectory()（"选择工作区"同一路径）；
     * 3) 兜底：Host 的 directoryPicker 服务。
     */
    async function pickSystemDirectory() {
      const desktop = globalThis.__DSH_DIRECTORY_PICKER__
      if (desktop && typeof desktop.pick === 'function') {
        const path = await desktop.pick()
        return path == null ? null : String(path)
      }
      let ws = null
      try { ws = clientCtx && typeof clientCtx.get === 'function' ? clientCtx.get('uiWorkspace') : null } catch (e) { ws = null }
      if (ws && typeof ws.pickDirectory === 'function') {
        const path = await ws.pickDirectory()
        return path == null ? null : String(path)
      }
      const r = await api.pick()
      if (!r.supported) return undefined
      return r.path ?? null
    }

    const baseName = (p) => String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p
    const sep = (p) => (String(p).includes('\\') || /^[A-Za-z]:/.test(String(p)) ? '\\' : '/')
    /** 面包屑：D:\DTS\x → [D:\, D:\DTS, D:\DTS\x] */
    function crumbsOf(p) {
      if (!p) return []
      const s = sep(p)
      const parts = String(p).replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean)
      const out = []
      let acc = String(p).startsWith('/') ? '' : ''
      parts.forEach((part, i) => {
        acc = i === 0 ? (/^[A-Za-z]:$/.test(part) ? part + s : (String(p).startsWith('/') ? '/' + part : part)) : (acc.endsWith(s) ? acc + part : acc + s + part)
        out.push({ label: i === 0 && /^[A-Za-z]:$/.test(part) ? part : part, path: acc })
      })
      return out
    }

    /**
     * 目录选择对话框（覆盖在面板上）。
     * mode：legacy（要重构的目录，只读，不提供新建）/ target（存放目录，可新建）/ project（打开已有项目，需含 refactorkit.yaml）
     */
    function DirPicker({ title, start, cwd, mode, onPick, onClose }) {
      const [data, setData] = useState(null)
      const [typed, setTyped] = useState(start || '')
      const [err, setErr] = useState('')
      const [places, setPlaces] = useState([])
      const [creating, setCreating] = useState(false)
      const [newName, setNewName] = useState('')
      const [showHidden, setShowHidden] = useState(false)
      const [sysMsg, setSysMsg] = useState('')
      const allowCreate = mode === 'target'
      const load = useCallback((p) => {
        setErr('')
        return api.list(p).then((d) => { setData(d); setTyped(d.path) }, (e) => setErr(e.message))
      }, [])
      useEffect(() => {
        api.places(cwd).then((r) => setPlaces(r.places || []), () => {})
        // 起点不存在（例如要新建的存放目录）时，退到最近的已存在上级
        const tryLoad = async (p) => {
          try { const d = await api.list(p); setData(d); setTyped(d.path) } catch (e) {
            const up = p && p.replace(/[\\/]+[^\\/]+[\\/]?$/, '')
            if (up && up !== p) return tryLoad(up)
            load('')
          }
        }
        tryLoad(start || cwd || '')
      }, [])
      const create = async () => {
        try {
          const r = await api.mkdir(data.path, newName.trim())
          setCreating(false); setNewName('')
          await load(r.path)
        } catch (e) { setErr(e.message) }
      }
      const system = async () => {
        setSysMsg('')
        try {
          const p = await pickSystemDirectory()
          if (p === undefined) { setSysMsg('当前环境不支持系统对话框'); return }
          if (p) { if (mode === 'project') await load(p); else onPick(p) }
        } catch (e) { setSysMsg('系统对话框打开失败：' + e.message) }
      }
      const cur = data && data.path
      const isRoot = data && data.isRoot
      const canPick = cur && !isRoot && (mode !== 'project' || data.hasConfig)
      const entries = data ? data.entries.filter((e) => showHidden || !e.hidden) : []
      const tags = data && !isRoot ? [
        data.isGit ? h('span', { key: 'g', className: 'rk-pill info' }, 'git 仓库') : null,
        data.hasConfig ? h('span', { key: 'c', className: 'rk-pill ok' }, '已是 RefactorKit 项目') : null,
      ] : null
      return h('div', { className: 'rk-modal', onClick: (e) => { if (e.target === e.currentTarget) onClose() } },
        h('div', { className: 'rk-dlg', role: 'dialog', 'aria-label': title },
          h('div', { className: 'rk-dlg-head' }, h('b', { className: 'rk-grow' }, title), h('button', { className: 'rk-x', onClick: onClose, 'aria-label': '关闭' }, '×')),
          h('div', { className: 'rk-dlg-bar' },
            h('button', { className: 'rk-btn', title: '上一级', disabled: !data || data.parent === null || isRoot, onClick: () => load(data.parent) }, '↑'),
            h('div', { className: 'rk-crumbs' },
              h('button', { className: 'rk-crumb', onClick: () => load('') }, '此电脑'),
              crumbsOf(cur).map((c) => h(React.Fragment, { key: c.path }, h('span', { className: 'rk-muted' }, '›'), h('button', { className: 'rk-crumb', onClick: () => load(c.path) }, c.label))))),
          h('div', { className: 'rk-dlg-bar' },
            h('input', { className: 'rk-in rk-grow', value: typed, spellCheck: false, onChange: (e) => setTyped(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') load(typed) }, placeholder: '粘贴或输入路径，回车前往' }),
            h('button', { className: 'rk-btn', onClick: () => load(typed) }, '前往')),
          places.length ? h('div', { className: 'rk-places' }, places.map((p) => h('button', { key: p.path, className: 'rk-place', title: p.path, onClick: () => load(p.path) }, p.label))) : null,
          err ? h('p', { className: 'rk-err', style: { margin: '4px 12px' } }, err) : null,
          h('div', { className: 'rk-dlg-list' },
            creating ? h('div', { className: 'rk-newdir' },
              h('span', null, '📁'),
              h('input', { className: 'rk-in rk-grow', autoFocus: true, value: newName, placeholder: '新文件夹名称', onChange: (e) => setNewName(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter' && newName.trim()) create(); if (e.key === 'Escape') setCreating(false) } }),
              h('button', { className: 'rk-btn primary', disabled: !newName.trim(), onClick: create }, '创建'),
              h('button', { className: 'rk-btn', onClick: () => setCreating(false) }, '取消')) : null,
            !data ? h('p', { className: 'rk-muted', style: { padding: 10 } }, '读取中…') : null,
            data && entries.length === 0 && !creating ? h('p', { className: 'rk-muted', style: { padding: 10 } }, allowCreate ? '空文件夹。可以直接选择它，或新建子文件夹。' : '没有子文件夹') : null,
            entries.map((e) => h('button', { key: e.path, className: 'rk-dir', title: '进入 ' + e.path, onClick: () => load(e.path) }, h('span', { className: 'rk-dir-ic' }, isRoot ? '💽' : '📁'), h('span', { className: 'rk-grow' }, e.name), h('span', { className: 'rk-muted' }, '›')))),
          h('div', { className: 'rk-dlg-sel' },
            h('span', { className: 'rk-muted' }, '已选：'),
            h('span', { className: 'rk-path rk-grow', title: cur || '' }, isRoot || !cur ? '（请进入一个文件夹）' : cur),
            tags),
          mode === 'project' && data && !isRoot && !data.hasConfig ? h('p', { className: 'rk-hint', style: { margin: '0 12px' } }, '这个文件夹里没有 refactorkit.yaml。请选择重构后存放的目录，或用"新建项目"。') : null,
          mode === 'legacy' && data && data.hasConfig ? h('p', { className: 'rk-hint', style: { margin: '0 12px', color: 'var(--dsw-alias-state-warn-primary)' } }, '这个文件夹已是 RefactorKit 项目（存放目录），通常不应作为要重构的老系统。') : null,
          sysMsg ? h('p', { className: 'rk-hint', style: { margin: '0 12px' } }, sysMsg + '，请在上方列表中选择。') : null,
          h('div', { className: 'rk-dlg-foot' },
            allowCreate ? h('button', { className: 'rk-btn', disabled: !cur || isRoot || creating, onClick: () => { setCreating(true); setNewName('') } }, '＋ 新建文件夹') : null,
            h('button', { className: 'rk-btn', onClick: system, title: '打开 Windows 选择文件夹窗口' }, '系统对话框…'),
            h('label', { className: 'rk-hint', style: { display: 'flex', alignItems: 'center', gap: 4 } }, h('input', { type: 'checkbox', checked: showHidden, onChange: (e) => setShowHidden(e.target.checked) }), '显示隐藏'),
            h('span', { className: 'rk-grow' }),
            h('button', { className: 'rk-btn', onClick: onClose }, '取消'),
            h('button', { className: 'rk-btn primary', disabled: !canPick, onClick: () => onPick(cur) }, canPick ? '选择「' + baseName(cur) + '」' : '选择'))))
    }

    /** 路径字段：显示路径与状态（git / 已是项目 / 不存在将创建），"浏览…"打开目录选择对话框。 */
    function PathField({ label, desc, value, onChange, pickerTitle, mode, cwd }) {
      const [open, setOpen] = useState(false)
      const [info, setInfo] = useState(null)
      useEffect(() => {
        if (!value) { setInfo(null); return undefined }
        let alive = true
        const t = setTimeout(() => {
          api.list(value).then((d) => alive && setInfo({ exists: true, isGit: d.isGit, hasConfig: d.hasConfig, count: d.entries.length }), () => alive && setInfo({ exists: false }))
        }, 300)
        return () => { alive = false; clearTimeout(t) }
      }, [value])
      let status = null
      if (value && info) {
        if (!info.exists) status = mode === 'target' ? h('span', { className: 'rk-pill warn' }, '新目录，初始化时创建') : h('span', { className: 'rk-pill bad' }, '目录不存在')
        else status = h(React.Fragment, null,
          h('span', { className: 'rk-pill ok' }, '已存在'),
          info.isGit ? h('span', { className: 'rk-pill info' }, 'git 仓库') : null,
          info.hasConfig ? h('span', { className: 'rk-pill info' }, '已是 RefactorKit 项目') : null,
          info.count === 0 ? h('span', { className: 'rk-pill mute' }, '空文件夹') : null)
      }
      return h('div', { className: 'rk-pathfield' },
        h('div', { className: 'rk-row' }, h('b', { className: 'rk-grow' }, label), status),
        desc ? h('div', { className: 'rk-hint', style: { marginBottom: 4 } }, desc) : null,
        h('div', { className: 'rk-row' },
          h('input', { className: 'rk-in rk-grow rk-mono', value: value || '', spellCheck: false, placeholder: '点击"浏览…"选择，或直接粘贴路径', onChange: (e) => onChange(e.target.value) }),
          h('button', { className: 'rk-btn primary', onClick: () => setOpen(true) }, '浏览…')),
        open ? h(DirPicker, { title: pickerTitle || label, start: value, cwd, mode, onClose: () => setOpen(false), onPick: (p) => { onChange(p); setOpen(false) } }) : null)
    }

    // ───────────── 新建项目 ─────────────
    function InitView({ cwd, sessionId, catalog, notify, onDone, onCancel }) {
      const [targetRoot, setTarget] = useState(cwd || '')
      const [legacyRoot, setLegacy] = useState('')
      const [srcKind, setSrcKind] = useState('local')
      const [gitUrl, setGitUrl] = useState('')
      const [cloneDir, setCloneDir] = useState('')
      const [repoName, setRepoName] = useState('')
      const [cloning, setCloning] = useState(false)
      const [name, setName] = useState('')
      const [draft, setDraft] = useState(null)
      const [busy, setBusy] = useState(false)
      const [err, setErr] = useState('')
      const detect = async () => {
        setBusy(true); setErr('')
        try { setDraft(await api.detect({ targetRoot, legacyRoot, name })) } catch (e) { setErr(e.message) } finally { setBusy(false) }
      }
      const probe = async (url) => {
        try { const r = await api.gitRepo(url); setRepoName(r.repoName); return r } catch (e) { setErr(e.message); return null }
      }
      const clone = async () => {
        setCloning(true); setErr('')
        try {
          const parent = cloneDir || cwd
          const r = await api.gitClone({ url: gitUrl, destParent: parent, repoName })
          setLegacy(r.target)
          if (!targetRoot) setTarget(r.target + (process.platform === 'win32' ? '\\重构后' : '/重构后'))
          notify('已克隆：' + r.target)
          setSrcKind('local')
        } catch (e) { setErr(e.message) } finally { setCloning(false) }
      }
      const differs = cwd && targetRoot && cwd.replace(/[\\/]+$/, '').toLowerCase() !== targetRoot.replace(/[\\/]+$/, '').toLowerCase()
      return h('div', null,
        h('div', { className: 'rk-card' },
          h('div', { className: 'rk-row' }, h('div', { className: 'rk-h rk-grow' }, '新建重构项目'), onCancel ? h('button', { className: 'rk-btn', onClick: onCancel }, '返回') : null),
          h('p', { className: 'rk-muted' }, '选好来源与存放目录后点"探测"，插件识别技术栈并生成配置草稿；在下面的表单检查后保存即完成初始化（等同 CP0 审核通过）。'),
          h('div', { className: 'rk-row', style: { marginBottom: 6 } },
            h('button', { type: 'button', className: 'rk-btn' + (srcKind === 'local' ? ' primary' : ''), onClick: () => setSrcKind('local') }, '本地目录'),
            h('button', { type: 'button', className: 'rk-btn' + (srcKind === 'git' ? ' primary' : ''), onClick: () => setSrcKind('git') }, 'Git 仓库')),
          srcKind === 'git'
            ? h('div', { className: 'rk-pathfield' },
                h('div', { className: 'rk-row' }, h('b', { className: 'rk-grow' }, '① 要重构的来源（Git 仓库）'), h('span', { className: 'rk-pill info' }, '克隆后只读')),
                h(Field, { label: '仓库地址' }, h('input', { className: 'rk-in rk-mono', value: gitUrl, spellCheck: false, placeholder: 'https://github.com/org/repo.git', onChange: (e) => { setGitUrl(e.target.value); setRepoName('') }, onBlur: () => gitUrl.trim() && !repoName && probe(gitUrl.trim()) })),
                h(Field, { label: '保存到（可选，默认当前会话目录）', hint: repoName ? '克隆为文件夹：' + repoName : '' }, h('input', { className: 'rk-in rk-mono', value: cloneDir, spellCheck: false, placeholder: cwd || '选择或输入目录', onChange: (e) => setCloneDir(e.target.value) })),
                h('div', { className: 'rk-row', style: { marginTop: 8 } },
                  h('button', { className: 'rk-btn primary', disabled: cloning || !gitUrl.trim(), onClick: clone }, cloning ? '克隆中…' : '克隆并作为要重构的目录')))
            : h(PathField, { label: '① 要重构的目录', desc: '老系统源码所在目录。插件只读取它，并拦截任何写入。', value: legacyRoot, onChange: setLegacy, pickerTitle: '选择要重构的目录（老系统）', mode: 'legacy', cwd }),
          h('div', { className: 'rk-arrow' }, '↓ 重构到'),
          h(PathField, { label: '② 重构后存放的目录', desc: '新系统代码写到这里。可选已有仓库，也可以在浏览时「新建文件夹」；refactorkit.yaml 与过程记录 .refactorkit/ 也放在这里。', value: targetRoot, onChange: setTarget, pickerTitle: '选择重构后存放的目录（新系统）', mode: 'target', cwd }),
          differs ? h('p', { className: 'rk-hint', style: { color: 'var(--dsw-alias-state-warn-primary)' } }, '提示：当前会话的工作目录是 ' + cwd + '。DSH 默认只允许会话写入自己的工作目录，建议在 DSH 中新建会话并把工作目录设为存放目录，或给本会话"完全访问"权限。') : null,
          h(Field, { label: '项目名称（可选）' }, h('input', { className: 'rk-in', value: name, onChange: (e) => setName(e.target.value) })),
          h('div', { className: 'rk-row', style: { marginTop: 8 } }, h('button', { className: 'rk-btn primary', disabled: busy || !targetRoot || !legacyRoot, onClick: detect }, busy ? '探测中…' : (draft ? '重新探测' : '探测并生成草稿'))),
          err ? h('p', { className: 'rk-err' }, err) : null),
        draft ? h(ConfigForm, {
          key: JSON.stringify(draft.config).length, initial: draft.config, catalog, saveLabel: '保存并初始化',
          extraTop: h('p', { className: 'rk-hint' }, (draft.targetExists ? '探测到：' + (draft.detected.stack.map((s) => s.kind + (s.springBoot ? ' (Spring Boot ' + s.springBoot + ')' : '')).join('、') || '未识别技术栈') : '存放目录还不存在，保存时会创建；技术栈与门禁请按目标技术栈填写') + '。带「副作用」的门禁运行前会再请你批准。'),
          onSave: async (c) => {
            const merged = Object.assign({}, draft.config, c, { project: Object.assign({}, draft.config.project, c.project) })
            await api.init({ targetRoot, config: merged, session: sessionId })
            notify('已初始化：' + targetRoot)
            onDone()
          },
        }) : null)
    }

    // ───────────── 选择 / 切换项目 ─────────────
    function ProjectChooser({ ctxInfo, sessionId, notify, onDone, onNew, onCancel }) {
      const [open, setOpen] = useState('')
      const bind = async (path) => {
        try { await api.bind({ session: sessionId, path }); notify('已切换项目'); onDone() } catch (e) { notify(e.message, true) }
      }
      const recent = (ctxInfo && ctxInfo.recent) || []
      return h('div', null,
        h('div', { className: 'rk-row', style: { marginBottom: 8 } },
          h('div', { className: 'rk-h rk-grow' }, '选择重构项目'),
          onCancel ? h('button', { className: 'rk-btn', onClick: onCancel }, '返回') : null),
        h('div', { className: 'rk-card' },
          h('b', null, '新建项目'),
          h('p', { className: 'rk-muted' }, '选择要重构的目录与重构后存放的目录，生成配置。'),
          h('button', { className: 'rk-btn primary', onClick: onNew }, '新建项目…')),
        h('div', { className: 'rk-card' },
          h('b', null, '打开已有项目'),
          h('p', { className: 'rk-muted' }, '选择一个含 refactorkit.yaml 的目录（重构后存放的目录）。'),
          h('button', { className: 'rk-btn', onClick: () => setOpen('pick') }, '浏览…'),
          open === 'pick' ? h(DirPicker, { title: '打开已有的重构项目', start: ctxInfo && ctxInfo.cwd, cwd: ctxInfo && ctxInfo.cwd, mode: 'project', onClose: () => setOpen(''), onPick: bind }) : null),
        recent.length ? h('div', { className: 'rk-card' },
          h('b', null, '最近的项目'),
          recent.map((r) => h('div', { key: r.configFile, className: 'rk-row', style: { marginTop: 6 } },
            h('div', { className: 'rk-grow', style: { minWidth: 0 } },
              h('div', null, r.name || '(未命名)'),
              h('div', { className: 'rk-hint rk-path', title: r.legacyRoot + ' → ' + r.root }, (r.legacyRoot || '?') + '  →  ' + r.root)),
            h('button', { className: 'rk-btn', onClick: () => bind(r.root) }, '使用')))) : null,
        ctxInfo && ctxInfo.bound ? h('button', { className: 'rk-link', onClick: async () => { await api.bind({ session: sessionId, unbind: true }); onDone() } }, '解除绑定，改用会话工作目录') : null)
    }

    // ───────────── 重构过程 ─────────────
    function ActivityView({ state, root }) {
      const [task, setTask] = useState('')
      const [data, setData] = useState(null)
      const [ev, setEv] = useState(null)
      const [err, setErr] = useState('')
      useEffect(() => {
        let alive = true
        const load = () => api.activity(root, task).then((d) => { if (alive) { setData(d); setErr('') } }, (e) => alive && setErr(e.message))
        load()
        const timer = setInterval(() => { if (document.visibilityState === 'visible') load() }, 3000)
        return () => { alive = false; clearInterval(timer) }
      }, [root, task])
      const showEvidence = async (id) => {
        try { setEv(await api.evidence(root, id)) } catch (e) { setErr(e.message) }
      }
      const items = (data && data.items) || []
      return h('div', null,
        h('div', { className: 'rk-row', style: { marginBottom: 8 } },
          h('select', { className: 'rk-sel', style: { width: 'auto' }, value: task, onChange: (e) => setTask(e.target.value) },
            h('option', { value: '' }, '全部过程'),
            ((data && data.tasks) || []).map((t) => h('option', { key: t.id, value: t.id }, t.id + ' ' + t.title + '（' + t.status + '）'))),
          h('span', { className: 'rk-muted' }, '共 ' + ((data && data.total) || 0) + ' 条记录，每 3 秒自动刷新')),
        err ? h('p', { className: 'rk-err' }, err) : null,
        ev ? h('div', { className: 'rk-card' },
          h('div', { className: 'rk-row' }, h('b', { className: 'rk-grow' }, '证据 ' + ev.id), h('button', { className: 'rk-btn', onClick: () => setEv(null) }, '关闭')),
          h('div', { className: 'rk-hint rk-path' }, ev.file),
          h('pre', { className: 'rk-pre' }, ev.text)) : null,
        items.length === 0 ? h('p', { className: 'rk-muted' }, '还没有过程记录。开始一个任务后，打开任务、分身、加载技能、门禁取证、仲裁、审查与人工审核都会按时间出现在这里。') : null,
        h('div', { className: 'rk-tl' }, items.map((it, i) => h('div', { key: i, className: 'rk-ev' },
          h('span', { className: 'rk-dot ' + (it.icon || '') }),
          h('div', { className: 'rk-row' },
            h('b', { className: 'rk-grow' }, it.title),
            h('span', { className: 'rk-hint' }, (it.taskId ? it.taskId + ' · ' : '') + String(it.at || '').replace('T', ' ').slice(5, 19))),
          it.text ? h('div', { className: 'rk-muted' }, it.text) : null,
          it.evidenceId ? h('button', { className: 'rk-link', onClick: () => showEvidence(it.evidenceId) }, '查看证据 ' + it.evidenceId) : null))))
    }

    // ───────────── 面板 ─────────────
    function Panel({ sessionId }) {
      const [ctxInfo, setCtxInfo] = useState(null)
      const [state, setState] = useState(null)
      const [err, setErr] = useState('')
      const [tab, setTab] = useState('')
      const [mode, setMode] = useState('main')
      const [toast, setToast] = useState(null)
      const [catalog, setCatalog] = useState([])
      const [ver, setVer] = useState(0)
      const refresh = useCallback(() => { setMode('main'); setVer((v) => v + 1) }, [])
      const notify = useCallback((msg, isErr) => { setToast({ msg, isErr }); setTimeout(() => setToast(null), 4000) }, [])

      useEffect(() => { api.models().then((r) => setCatalog(r.providers || []), () => {}) }, [])
      useEffect(() => {
        let alive = true
        api.context(sessionId).then((c) => { if (alive) { setCtxInfo(c); setErr('') } }, (e) => alive && setErr(e.message))
        return () => { alive = false }
      }, [sessionId, ver])
      const root = ctxInfo && ctxInfo.root
      useEffect(() => {
        if (!root) return undefined
        let alive = true
        const load = () => api.state(root).then((s) => { if (alive) { setState(s); setErr('') } }, (e) => alive && setErr(e.message))
        load()
        const timer = setInterval(() => { if (document.visibilityState === 'visible') load() }, 3000)
        return () => { alive = false; clearInterval(timer) }
      }, [root, ver])

      const pendingCount = state ? (state.pending || []).length : 0
      const noteCount = state ? (state.notes || []).length : 0
      const active = tab || (pendingCount > 0 ? 'reviews' : 'overview')
      const tabs = [['reviews', '待审核', pendingCount + noteCount], ['overview', '概览'], ['activity', '过程'], ['gaps', '缺口'], ['tasks', '任务'], ['config', '配置']]
      const ready = ctxInfo && ctxInfo.initialized && !ctxInfo.error
      const cwd = ctxInfo && (ctxInfo.suggestedTarget || ctxInfo.cwd)

      let body
      if (err && !ctxInfo) body = h('p', { className: 'rk-err' }, err)
      else if (!ctxInfo) body = h('p', { className: 'rk-muted' }, '读取会话…')
      else if (mode === 'new' || (!ctxInfo.initialized && mode === 'main' && !(ctxInfo.recent || []).length)) {
        body = h(InitView, { cwd, sessionId, catalog, notify, onDone: refresh, onCancel: (ctxInfo.initialized || (ctxInfo.recent || []).length) ? () => setMode(ctxInfo.initialized ? 'main' : 'choose') : null })
      } else if (mode === 'choose' || !ctxInfo.initialized) {
        body = h(ProjectChooser, { ctxInfo, sessionId, notify, onDone: refresh, onNew: () => setMode('new'), onCancel: ctxInfo.initialized ? () => setMode('main') : null })
      } else if (ctxInfo.error) {
        body = h('div', null, h('p', { className: 'rk-err' }, ctxInfo.error), h('button', { className: 'rk-btn', onClick: refresh }, '重新读取'), ' ', h('button', { className: 'rk-btn', onClick: () => setMode('choose') }, '切换项目'))
      } else if (!state) body = h('p', { className: 'rk-muted' }, err || '读取项目…')
      else {
        const props = { state, root, refresh, notify }
        body = active === 'reviews' ? h(ReviewsView, props)
          : active === 'activity' ? h(ActivityView, props)
          : active === 'gaps' ? h(GapsView, props)
          : active === 'tasks' ? h(TasksView, props)
          : active === 'config' ? h(ConfigView, { root, catalog, notify, refresh })
          : h(OverviewView, props)
      }
      const showTabs = ready && mode === 'main'
      return h('div', { className: 'rk' },
        h('style', null, CSS),
        h('div', { className: 'rk-head' },
          h('div', { className: 'rk-title' }, 'RefactorKit', h('span', { className: 'rk-sub rk-grow' }, ready ? (ctxInfo.name || '') : ''),
            ready && mode === 'main' ? h('button', { className: 'rk-link', onClick: () => setMode('choose') }, '切换项目') : null),
          ready && mode === 'main' ? h('div', { className: 'rk-proj' },
            h('span', null, '要重构'), h('span', { className: 'rk-path', title: ctxInfo.legacyRoot }, ctxInfo.legacyRoot),
            h('span', null, '存放到'), h('span', { className: 'rk-path', title: ctxInfo.targetRoot }, ctxInfo.targetRoot)) : null,
          ready && mode === 'main' && ctxInfo.outsideSession ? h('div', { className: 'rk-hint', style: { color: 'var(--dsw-alias-state-warn-primary)' } }, '存放目录不在本会话工作目录内：DSH 可能拦截模型写入。建议新建会话并把工作目录设为存放目录。') : null,
          showTabs ? h('div', { className: 'rk-tabs' }, tabs.map(([id, label, n]) => h('button', { key: id, className: 'rk-tab' + (active === id ? ' on' : ''), onClick: () => setTab(id) }, label, n ? h('span', { className: 'rk-badge' }, n) : null))) : h('div', { style: { height: 8 } })),
        h('div', { className: 'rk-body' }, body, toast ? h('div', { className: 'rk-toast', style: toast.isErr ? { color: 'var(--dsw-alias-state-error-primary)' } : null }, toast.msg) : null))
    }

    function TabBody(props) {
      return h(Panel, { sessionId: props.sessionId })
    }

    // ───────────── 输入框下方的"重构"按钮（排在"费用明细"之后） ─────────────
    const pendingStore = { count: 0, listeners: new Set() }
    function setPendingCount(n) {
      if (n === pendingStore.count) return
      pendingStore.count = n
      for (const fn of pendingStore.listeners) fn(n)
    }
    let openPanel = () => {}

    function DockButton(props) {
      const [n, setN] = useState(pendingStore.count)
      useEffect(() => {
        pendingStore.listeners.add(setN)
        return () => { pendingStore.listeners.delete(setN) }
      }, [])
      if (!props.sessionId) return null
      return h(React.Fragment, null,
        h('style', null, DOCK_CSS),
        h('button', { type: 'button', className: 'rk-dock-btn', title: 'RefactorKit：重构项目、审核与过程', 'aria-label': '打开 RefactorKit 重构面板', onClick: () => openPanel() },
          '重构', n ? h('span', { className: 'rk-dock-n' }, n) : null))
    }

    // ───────────── 注册 ─────────────
    exports.inject = ['slots', 'sidebarRightTabs', 'sidebarRight']
    exports.apply = function apply(ctx) {
      setClientCtx(ctx)
      openPanel = () => { try { ctx.sidebarRight.openTab(TAB_KIND) } catch (e) { console.warn('[refactorkit] 无法打开面板：', e) } }
      ctx.effect(() => ctx.sidebarRightTabs.register({
        id: TAB_ID,
        kind: TAB_KIND,
        priority: 'extension',
        title: () => 'RefactorKit',
        guide: [{ id: 'refactorkit', order: 60, title: () => 'RefactorKit 重构', description: () => '项目、审核与重构过程' }],
      }), 'refactorkit: tab type')
      ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
        name: 'sidebar.right.pane.tab',
        key: TAB_ID,
        inject: (sessionId) => ({ sessionId }),
      }, TabBody)), 'refactorkit: tab body')
      // dsh-cost-meter 的"费用明细"同时出现在会话顶部（conversation.session.header.actions）与输入框下方
      // （conversation.composer.dock），order 都是 1；本按钮在两处都以 order 2 排在其后
      for (const slot of ['conversation.composer.dock', 'conversation.session.header.actions']) {
        ctx.effect(() => ctx.slots.inject(slot, () => ctx.slots.register({
          name: slot,
          id: 'refactorkit-entry',
          order: 2,
          inject: () => ({}),
        }, DockButton)), 'refactorkit: entry button ' + slot)
      }

      // 全局轮询：报到 + 更新按钮角标 + 发现新的待审核项时自动打开面板
      const seen = new Set()
      const tick = async () => {
        try {
          const r = await call('GET', '/pending')
          const list = r.pending || []
          setPendingCount(list.length)
          const fresh = list.filter((p) => !seen.has(p.id))
          for (const p of list) seen.add(p.id)
          if (fresh.length > 0) openPanel()
        } catch (e) { /* Host 未注册路由（如旧版本）时静默 */ }
      }
      ctx.effect(() => {
        const timer = setInterval(tick, 3000)
        tick()
        return () => clearInterval(timer)
      }, 'refactorkit: pending poller')
    }

    // 仅供测试：服务端渲染各视图
    exports.__test = { Panel, ConfigForm, ReviewCard, ReviewsView, OverviewView, GapsView, TasksView, InitView, ProjectChooser, ActivityView, DirPicker, PathField, DockButton, Md, pickSystemDirectory, setClientCtx, crumbsOf }

    module.exports = exports
    return module.exports
  },
})
