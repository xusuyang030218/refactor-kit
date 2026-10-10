// 面板测试：Host 路由（纯函数 handle）、审核中转往返、浏览器端各视图服务端渲染。
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import vm from 'node:vm'
import * as broker from '../src/plugin/broker.js'
import { _setRegistryFile } from '../src/plugin/registry.js'
import { projectDirOf } from '../src/plugin/runtime.js'
import { runCheckpoint } from '../src/plugin/checkpoint.js'
import { createApi } from '../src/plugin/web.js'
import { openProject } from '../src/app/project.js'

const require = createRequire(import.meta.url)
let tmp, target, legacy, api
const q = (o = {}) => new URLSearchParams(o)

before(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'rk-panel-'))
  _setRegistryFile(join(tmp, 'registry', 'projects.json'))
  target = join(tmp, 'target')
  legacy = join(tmp, 'legacy')
  await mkdir(join(legacy, 'src'), { recursive: true })
  await writeFile(join(legacy, 'src', 'DataSetController.java'), '@RestController\n@RequestMapping("/ds")\npublic class DataSetController {\n@GetMapping("/a.do") void a(){}\n@GetMapping("/b.do") void b(){}\n}\n')
  await writeFile(join(legacy, 'src', 'MmsController.java'), '@Controller\n@RequestMapping("/mms")\npublic class MmsController {\n@GetMapping("/send") void a(){}\n}\n')
  await mkdir(join(target, 'server', 'src'), { recursive: true })
  await writeFile(join(target, 'server', 'pom.xml'), '<project/>')
  await writeFile(join(target, 'server', 'src', 'DatasetController.java'), '@RestController\n@RequestMapping("/api/v1/datasets")\npublic class DatasetController {\n@GetMapping("") void a(){}\n}\n')
  await writeFile(join(target, 'server', 'src', 'MessageController.java'), '@RestController\n@RequestMapping("/api/v1/messages")\npublic class MessageController {\n@GetMapping("") void a(){}\n}\n')
  execFileSync('git', ['init', '-q'], { cwd: target })
  api = createApi({
    sessions: () => ({ get: (id) => (id === 'sess-1' ? { header: { cwd: target } } : undefined) }),
    llm: () => ({
      // 与 DSH dsh-llm 的真实形状一致：{ id: 路由名, name: 显示名 }
      listProviders: () => [{ id: 'gpt', name: 'GPT' }, { id: 'anthropic', name: 'anthropic' }],
      listModels: async (p) => (p === 'gpt' ? [{ provider: 'gpt', id: 'gpt-5.5', name: 'gpt-5.5' }] : [{ provider: p, id: 'claude-opus-5-5', name: 'Opus' }]),
    }),
  })
})
after(async () => { await rm(tmp, { recursive: true, force: true }) })

describe('Host 路由', () => {
  test('context：会话 → 工作目录 → 未初始化', async () => {
    const r = await api.handle('GET', '/context', q({ session: 'sess-1' }))
    assert.equal(r.status, 200)
    assert.equal(r.body.cwd, target)
    assert.equal(r.body.initialized, false)
    const none = await api.handle('GET', '/context', q({ session: 'nope' }))
    assert.equal(none.body.cwd, null)
  })

  test('models：读取 DSH 的 provider 与模型', async () => {
    const r = await api.handle('GET', '/models', q())
    assert.deepEqual(r.body.providers.map((p) => p.provider), ['gpt', 'anthropic'])
    assert.equal(r.body.providers[0].label, 'GPT（gpt）')
    assert.equal(r.body.providers[1].label, 'anthropic')
    assert.equal(r.body.providers[0].models[0].id, 'gpt-5.5')
  })

  test('detect + init：向导写入配置并记 CP0；重复初始化被拒', async () => {
    const d = await api.handle('POST', '/detect', q(), { targetRoot: target, legacyRoot: legacy, name: '面板测试' })
    assert.equal(d.status, 200, JSON.stringify(d.body))
    const config = d.body.config
    config.gates = { unit: { command: 'node -e "process.exit(0)"', kind: 'test' } }
    config.commandAllowlist = ['node -e', 'git diff']
    config.slots = { reviewer: { candidates: [{ provider: 'gpt', model: 'gpt-5.5' }] } }
    const bad = await api.handle('POST', '/init', q(), { targetRoot: target, config: { ...config, project: { ...config.project, writeScope: [] } } })
    assert.equal(bad.status, 422)
    assert.match(bad.body.error, /writeScope/)
    const ok = await api.handle('POST', '/init', q(), { targetRoot: target, config })
    assert.equal(ok.status, 200, JSON.stringify(ok.body))
    assert.match(await readFile(join(target, 'refactorkit.yaml'), 'utf8'), /RefactorKit 面板中审核/)
    const again = await api.handle('POST', '/init', q(), { targetRoot: target, config })
    assert.equal(again.status, 409)
    const c = await api.handle('GET', '/context', q({ session: 'sess-1' }))
    assert.equal(c.body.initialized, true)
    assert.equal(c.body.root, target)
  })

  test('config：读取可编辑视图；保存保留注释；非法配置 422 且不落盘', async () => {
    const file = join(target, 'refactorkit.yaml')
    await writeFile(file, `# 我的注释\n${await readFile(file, 'utf8')}`)
    const g = await api.handle('GET', '/config', q({ root: target }))
    assert.equal(g.body.valid, true)
    const cfg = g.body.config
    cfg.review.preset = 'strict'
    cfg.slots = { fast: { provider: 'gpt', model: 'gpt-5.5' }, reviewer: { candidates: [{ provider: 'gpt', model: 'gpt-5.5' }] } }
    const s = await api.handle('POST', '/config', q(), { root: target, config: cfg })
    assert.equal(s.status, 200, JSON.stringify(s.body))
    const text = await readFile(file, 'utf8')
    assert.match(text, /# 我的注释/)
    assert.match(text, /preset: strict/)
    const before = text
    const bad = await api.handle('POST', '/config', q(), { root: target, config: { gates: { x: { command: 'curl evil' } } } })
    assert.equal(bad.status, 422)
    assert.match(bad.body.error, /commandAllowlist/)
    assert.equal(await readFile(file, 'utf8'), before, '非法配置不应写入')
  })

  test('action：盘点 → 缺口 → 改对应 → 裁撤 / 撤销；state 汇总', async () => {
    assert.equal((await api.handle('POST', '/action', q(), { root: target, op: 'survey' })).status, 200)
    assert.equal((await api.handle('POST', '/action', q(), { root: target, op: 'gaps' })).status, 200)
    let st = (await api.handle('GET', '/state', q({ root: target }))).body
    const mms = () => st.gaps.find((x) => x.className === 'MmsController')
    assert.equal(mms().status, 'missing')
    assert.deepEqual(st.targetControllers, ['DatasetController', 'MessageController'])
    const m = await api.handle('POST', '/action', q(), { root: target, op: 'mapping', args: { className: 'MmsController', targets: ['MessageController'] } })
    assert.equal(m.status, 200, JSON.stringify(m.body))
    st = (await api.handle('GET', '/state', q({ root: target }))).body
    assert.equal(mms().basis, 'mapping')
    assert.equal(mms().status, 'covered')
    await api.handle('POST', '/action', q(), { root: target, op: 'retire', args: { ids: ['G-MmsController'], reason: '短信网关下线' } })
    st = (await api.handle('GET', '/state', q({ root: target }))).body
    assert.equal(mms().status, 'retired')
    await api.handle('POST', '/action', q(), { root: target, op: 'unretire', args: { ids: ['G-MmsController'] } })
    st = (await api.handle('GET', '/state', q({ root: target }))).body
    assert.equal(mms().status, 'covered')
    const rep = await api.handle('POST', '/action', q(), { root: target, op: 'report' })
    assert.match(rep.body.file, /report\.html$/)
    assert.equal((await api.handle('POST', '/action', q(), { root: target, op: 'bogus' })).status, 400)
  })

  test('未知接口 404；缺参数 400', async () => {
    assert.equal((await api.handle('GET', '/nope', q())).status, 404)
    assert.equal((await api.handle('GET', '/state', q())).status, 400)
  })
})

describe('目录选择、项目绑定与重构过程', () => {
  test('fs/list：列出子目录并标记含配置 / git；无法读取返回 400', async () => {
    const r = await api.handle('GET', '/fs/list', q({ path: tmp }))
    assert.equal(r.status, 200)
    assert.deepEqual(r.body.entries.map((e) => e.name).filter((n) => n !== 'registry').sort(), ['legacy', 'target'])
    const t = await api.handle('GET', '/fs/list', q({ path: target }))
    assert.equal(t.body.hasConfig, true)
    assert.equal(t.body.isGit, true)
    assert.equal(t.body.parent, tmp)
    assert.equal((await api.handle('GET', '/fs/list', q({ path: join(tmp, 'nope') }))).status, 400)
    const roots = await api.handle('GET', '/fs/list', q())
    assert.ok(roots.body.entries.length > 0, '空路径列出驱动器 / 根目录')
  })

  test('fs/mkdir：新建文件夹；非法名称 / 已存在 / 上级不存在被拒', async () => {
    const r = await api.handle('POST', '/fs/mkdir', q(), { path: tmp, name: '新系统输出' })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.equal(r.body.path, join(tmp, '新系统输出'))
    assert.equal((await api.handle('GET', '/fs/list', q({ path: r.body.path }))).status, 200)
    assert.equal((await api.handle('POST', '/fs/mkdir', q(), { path: tmp, name: '新系统输出' })).status, 409)
    assert.equal((await api.handle('POST', '/fs/mkdir', q(), { path: tmp, name: 'a/b' })).status, 400)
    assert.equal((await api.handle('POST', '/fs/mkdir', q(), { path: tmp, name: '..' })).status, 400)
    assert.equal((await api.handle('POST', '/fs/mkdir', q(), { path: join(tmp, 'nope'), name: 'x' })).status, 400)
  })

  test('fs/places：会话目录在前，含驱动器 / 根目录', async () => {
    const r = await api.handle('GET', '/fs/places', q({ cwd: target }))
    assert.equal(r.body.places[0].label, '会话目录')
    assert.equal(r.body.places[0].path, target)
    assert.ok(r.body.places.some((p) => /盘$|根目录/.test(p.label)))
  })

  test('git 导入：地址格式校验（不触发网络）', async () => {
    assert.equal((await api.handle('GET', '/git/repo', q({ url: 'not a url' }))).status, 400)
    assert.equal((await api.handle('POST', '/git/clone', q(), { url: 'javascript:alert(1)', destParent: tmp, repoName: 'x' })).status, 400)
    assert.equal((await api.handle('POST', '/git/clone', q(), { url: 'https://github.com/a/b.git', destParent: join(tmp, 'nope'), repoName: 'x' })).status, 400, '目标上级目录不存在')
    assert.equal((await api.handle('POST', '/git/clone', q(), { url: 'https://github.com/a/b.git', destParent: tmp, repoName: 'a/b' })).status, 400, '仓库名含非法字符')
  })

  test('fs/pick：无系统选择器时 supported=false', async () => {
    assert.deepEqual((await api.handle('POST', '/fs/pick', q(), {})).body, { supported: false })
  })

  test('新建到独立的存放目录：detect 允许新目录；init 创建目录并绑定会话；context 与工具都解析到它', async () => {
    const out = join(tmp, 'out', 'rebuilt')
    const d = await api.handle('POST', '/detect', q(), { targetRoot: out, legacyRoot: legacy })
    assert.equal(d.status, 200, JSON.stringify(d.body))
    assert.equal(d.body.targetExists, false)
    assert.equal((await api.handle('POST', '/detect', q(), { targetRoot: legacy, legacyRoot: legacy })).status, 400, '存放目录不能等于老仓')
    const ok = await api.handle('POST', '/init', q(), { targetRoot: out, config: d.body.config, session: 'sess-2' })
    assert.equal(ok.status, 200, JSON.stringify(ok.body))
    const api2 = createApi({ sessions: () => ({ get: () => ({ header: { cwd: target } }) }) })
    const c = await api2.handle('GET', '/context', q({ session: 'sess-2' }))
    assert.equal(c.body.root, out)
    assert.equal(c.body.bound, true)
    assert.equal(c.body.legacyRoot, legacy)
    assert.equal(c.body.outsideSession, true)
    assert.ok(c.body.recent.some((r) => r.root === out))
    const exec = { agent: { session: { header: { id: 'sess-2', cwd: target } } } }
    assert.equal(await projectDirOf(exec), out)
    await api.handle('POST', '/bind', q(), { session: 'sess-2', unbind: true })
    assert.equal((await api2.handle('GET', '/context', q({ session: 'sess-2' }))).body.root, target)
    const b = await api.handle('POST', '/bind', q(), { session: 'sess-2', path: out })
    assert.equal(b.status, 200)
    assert.equal((await api.handle('POST', '/bind', q(), { session: 'sess-2', path: legacy })).status, 404, '老仓没有配置，不能打开')
  })

  test('技术选型：tech-add / tech-del / state 返回；report 看板含技术选型', async () => {
    let st = (await api.handle('GET', '/state', q({ root: target }))).body
    assert.deepEqual(st.tech, [], '初始无技术选型')
    assert.equal((await api.handle('POST', '/action', q(), { root: target, op: 'tech-add', args: { area: 'Spring Boot 版本', decision: '升级到 3.x', rationale: 'javax→jakarta' } })).status, 200)
    st = (await api.handle('GET', '/state', q({ root: target }))).body
    assert.equal(st.tech.length, 1)
    assert.equal(st.tech[0].area, 'Spring Boot 版本')
    assert.equal(st.tech[0].by, 'user')
    const { project } = await openProject(target)
    const rep = await project.writeReport()
    assert.match(await readFile(rep, 'utf8'), /技术选型/)
    assert.equal((await api.handle('POST', '/action', q(), { root: target, op: 'tech-del', args: { id: st.tech[0].id } })).status, 200)
    st = (await api.handle('GET', '/state', q({ root: target }))).body
    assert.equal(st.tech.length, 0)
    assert.equal((await api.handle('POST', '/action', q(), { root: target, op: 'tech-add', args: { area: '' } })).status, 400, '维度必填')
  })

  test('activity：决策日志翻译为时间线，可按任务过滤；evidence 可查看原文', async () => {
    const { project } = await openProject(target)
    await project.ledger.journal({ kind: 'task-open', taskId: 'T-01', detail: { title: '导出', gapIds: ['G-A'], risk: 'L2' } })
    await project.ledger.journal({ kind: 'delegate', taskId: 'T-01', detail: { lens: 'archaeologist', provider: 'aliyun-maas', model: 'qwen', why: '只要结论', readOnly: true } })
    await project.ledger.journal({ kind: 'skill-load', detail: { name: 'rk-playbook', agent: { provider: 'anthropic', model: 'opus' } } })
    const runs = await project.runNamedGates(['unit'])
    const a = await api.handle('GET', '/activity', q({ root: target }))
    assert.equal(a.status, 200)
    const titles = a.body.items.map((i) => i.title)
    assert.ok(titles.includes('打开任务「导出」'))
    assert.ok(titles.includes('分身（archaeologist）→ aliyun-maas/qwen'))
    assert.ok(titles.includes('加载技能 rk-playbook'))
    const gate = a.body.items.find((i) => i.kind === 'gate')
    assert.equal(gate.evidenceId, runs[0].id)
    assert.ok(Date.parse(a.body.items[0].at) >= Date.parse(a.body.items.at(-1).at), '最新的在前')
    const onlyT1 = await api.handle('GET', '/activity', q({ root: target, task: 'T-01' }))
    assert.equal(onlyT1.body.items.length, 2)
    const ev = await api.handle('GET', '/evidence', q({ root: target, id: runs[0].id }))
    assert.equal(ev.status, 200)
    assert.match(ev.body.text, /command: node -e/)
    assert.equal((await api.handle('GET', '/evidence', q({ root: target, id: '../../x' }))).status, 400)
  })
})

describe('面板审核往返', () => {
  test('面板在线：阻塞审核进入待审核列表，面板"修改后通过"写回审核文件', async () => {
    broker._reset()
    broker.touchPanel()
    const { project } = await openProject(target)
    const card = {
      header: 'CP2 任务契约', question: '契约是否认可？', detail: '**T-01**',
      fileContent: '# CP2\n\n```yaml rk-contract\n- id: A1\n  statement: 原断言\n  check: { gate: unit }\n```\n',
    }
    const waiting = runCheckpoint({ ctx: { get: () => undefined }, exec: { signal: new AbortController().signal }, project }, { cp: 'CP2', taskId: undefined, risk: 'L2', card, fileRel: 'T-99/CP2-contract.md' })
    await new Promise((r) => setTimeout(r, 50))
    const pending = (await api.handle('GET', '/pending', q())).body.pending
    assert.equal(pending.length, 1)
    assert.equal(pending[0].editable.block, 'contract')
    assert.match(pending[0].editable.text, /原断言/)
    const st = (await api.handle('GET', '/state', q({ root: target }))).body
    assert.equal(st.pending.length, 1, 'state 中也能看到该待审核项')
    const edited = pending[0].editable.text.replace('原断言', '面板中修改后的断言')
    const r = await api.handle('POST', '/review', q(), { id: pending[0].id, outcome: 'approved-with-changes', edited })
    assert.equal(r.status, 200)
    const result = await waiting
    assert.equal(result.outcome, 'approved-with-changes')
    assert.match(await readFile(join(target, '.refactorkit', 'review', 'T-99', 'CP2-contract.md'), 'utf8'), /面板中修改后的断言/)
    assert.equal((await api.handle('POST', '/review', q(), { id: pending[0].id, outcome: 'approved' })).status, 410, '重复答复返回 410')
  })

  test('提意见必须有内容；取消工具调用时待审核项消失', async () => {
    broker._reset()
    broker.touchPanel()
    const { project } = await openProject(target)
    const ac = new AbortController()
    const card = { header: 'CP3 关键决策', question: '选哪个？', detail: 'x', fileContent: '# CP3\n', options: [{ label: 'A' }, { label: 'B' }] }
    const waiting = runCheckpoint({ ctx: { get: () => undefined }, exec: { signal: ac.signal }, project }, { cp: 'CP3', card, fileRel: '_project/CP3.md' })
    await new Promise((r) => setTimeout(r, 50))
    const [item] = broker.listPending()
    assert.equal(item.custom, true)
    assert.equal((await api.handle('POST', '/review', q(), { id: item.id, outcome: 'feedback' })).status, 400)
    ac.abort()
    await assert.rejects(waiting, /取消/)
    assert.equal(broker.listPending().length, 0)
  })

  test('面板不在线：回退到问答卡路径', async () => {
    broker._reset()
    const { project } = await openProject(target)
    const card = { header: 'CP3', question: '?', detail: 'x', fileContent: '# x\n' }
    const r = await runCheckpoint({ ctx: { get: () => undefined }, exec: {}, project }, { cp: 'CP3', card, fileRel: '_project/CP3b.md' })
    assert.equal(r.outcome, 'unanswered', '无面板、无问答卡服务 → 视为未通过（不默认放行）')
    assert.equal(broker.listPending().length, 0)
  })

  test('待阅（notify）项可在面板标记已阅', async () => {
    const { project } = await openProject(target)
    await project.addProjectReview({ checkpoint: 'CP4', policy: 'notify', outcome: 'noted', file: 'f.md', askedAt: new Date().toISOString() })
    let st = (await api.handle('GET', '/state', q({ root: target }))).body
    const note = st.notes.find((n) => n.checkpoint === 'CP4')
    assert.ok(note)
    const r = await api.handle('POST', '/ack', q(), { root: target, index: note.index })
    assert.equal(r.status, 200)
    st = (await api.handle('GET', '/state', q({ root: target }))).body
    assert.equal(st.notes.filter((n) => n.checkpoint === 'CP4').length, 0)
  })
})

describe('浏览器端', () => {
  /** 按 DSH 模块加载器协议加载 client/index.js。 */
  async function loadClient() {
    const code = await readFile(new URL('../client/index.js', import.meta.url), 'utf8')
    let loaded
    const sandbox = {
      window: { __ModuleLoader__: { load: (m) => { loaded = m } } },
      URLSearchParams, setTimeout, clearTimeout, setInterval, clearInterval, console,
    }
    vm.runInNewContext(code, sandbox, { filename: 'client/index.js' })
    assert.equal(loaded.id, 'dsh-plugin-refactorkit')
    const table = { react: require('react') }
    const mod = loaded.factory((name) => {
      if (!(name in table)) throw new Error(`客户端引用了平台未提供的模块：${name}`)
      return table[name]
    })
    // 客户端代码里的 globalThis / fetch 指向沙箱对象
    Object.defineProperty(mod, '__sandbox', { value: sandbox, enumerable: false })
    return mod
  }

  test('模块协议：只依赖 react；注册右侧栏标签与正文', async () => {
    const mod = await loadClient()
    // 客户端运行在 vm 沙箱（另一个 realm），比较前转为本 realm 的值
    assert.deepEqual(JSON.parse(JSON.stringify(mod.inject)), ['slots', 'sidebarRightTabs', 'sidebarRight'])
    const reg = { tabs: [], slots: [], effects: [] }
    const ctx = {
      effect: (fn) => { reg.effects.push(fn()) },
      sidebarRightTabs: { register: (d) => { reg.tabs.push(d); return () => {} } },
      slots: { inject: (_n, fn) => fn(), register: (opts, comp) => { reg.slots.push({ opts, comp }); return () => {} } },
      sidebarRight: { openTab: () => {} },
    }
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ pending: [] }) })
    mod.apply(ctx)
    assert.equal(reg.tabs[0].kind, 'refactorkit')
    assert.equal(reg.tabs[0].title(), 'RefactorKit')
    assert.equal(reg.tabs[0].guide[0].title(), 'RefactorKit 重构')
    assert.equal(reg.slots[0].opts.name, 'sidebar.right.pane.tab')
    assert.equal(reg.slots[0].opts.key, 'dsh-plugin-refactorkit')
    assert.deepEqual(JSON.parse(JSON.stringify(reg.slots[0].opts.inject('sess-1'))), { sessionId: 'sess-1' })
    const dock = reg.slots.find((s) => s.opts.name === 'conversation.composer.dock')
    assert.ok(dock, '应注册到 conversation.composer.dock（与"费用明细"同一位置）')
    assert.equal(dock.opts.id, 'refactorkit-entry')
    assert.ok(dock.opts.order > 1, '排在"费用明细"（order 1）之后')
    for (const d of reg.effects) if (typeof d === 'function') d()
  })

  test('各视图服务端渲染无错误，并包含关键内容', async () => {
    const client = await loadClient()
    const { __test: T } = client
    const sb = client.__sandbox
    const { renderToString } = require('react-dom/server')
    const React = require('react')
    const render = (C, p) => renderToString(React.createElement(C, p))
    const noop = () => {}
    const catalog = [{ provider: 'gpt', label: 'GPT', models: [{ id: 'gpt-5.5', name: 'gpt-5.5' }] }]
    const config = {
      project: { name: 'DTS', legacyRoot: 'D:/legacy', writeScope: ['server/**'], memoryFiles: [] },
      slots: { fast: { provider: 'gpt', model: 'gpt-5.5' }, reviewer: { candidates: [{ provider: 'gpt', model: 'gpt-5.5' }] } },
      autonomy: { default: 'assisted', byModel: { 'gpt/gpt-5.*': 'free' } },
      review: { preset: 'standard', ui: 'auto' },
      gates: { unit: { command: 'mvn -q test', cwd: 'server' }, smoke: { command: 'pwsh x.ps1', sideEffect: true } },
      commandAllowlist: ['mvn -q'],
    }
    const form = render(T.ConfigForm, { initial: config, catalog, onSave: noop, saveLabel: '保存配置' })
    // 高级设置（模型槽/门禁/审核等）默认折叠；基础项始终显示
    for (const s of ['项目名称', '老系统仓库', '允许写入的目录', '高级设置', '保存配置']) assert.ok(form.includes(s), `配置表单缺少：${s}`)
    assert.ok(!form.includes('模型槽'), '高级设置默认折叠，不应直接渲染模型槽')
    const item = { id: 'x', header: 'CP2 任务契约', question: '契约是否认可？', detail: '| # | 断言 |\n|---|---|\n| A1 | **单测** |', file: '.refactorkit/review/T-01/CP2-contract.md', options: [{ label: '通过' }], editable: { block: 'contract', text: '- id: A1\n' } }
    const card = render(T.ReviewCard, { item, onDone: noop, notify: noop })
    for (const s of ['CP2 任务契约', '<table', '<b>单测</b>', 'rk-contract', '提意见退回', '驳回']) assert.ok(card.includes(s), `审核卡缺少：${s}`)
    const decision = render(T.ReviewCard, { item: { ...item, editable: undefined, custom: true, options: [{ label: 'A 新表' }, { label: 'B 文件' }] }, onDone: noop, notify: noop })
    assert.ok(decision.includes('A 新表') && decision.includes('B 文件'))
    const state = {
      status: { state: 'in-progress', nextSteps: ['T-01 缺证据'] }, preset: 'standard',
      gapSummary: { total: 2, missing: 1, partial: 0, covered: 1, retired: 0, endpointCoverage: 0.5 },
      survey: { weighted: 0.52 },
      gaps: [{ id: 'G-A', className: 'A', endpoints: 3, estMatched: 0, coverage: 0, status: 'missing', basis: 'none', mappedTo: [] }],
      targetControllers: ['B'],
      tasks: [{ id: 'T-01', title: '导出', status: 'OPEN', riskEstimate: { level: 'L2' }, contract: [{ id: 'A1', statement: 's', check: { gate: 'unit' } }], results: {}, reviews: [], humanReviews: [], closeAttempts: [{ missing: ['② 缺审查'] }] }],
      pending: [item], notes: [{ checkpoint: 'CP4', taskId: 'T-01', index: 0, file: 'f.md', askedAt: '2026-10-09T10:00:00Z' }], memory: [],
    }
    const props = { state, root: 'D:/t', refresh: noop, notify: noop }
    assert.ok(render(T.OverviewView, props).includes('T-01 缺证据'))
    assert.ok(render(T.GapsView, props).includes('G-A'))
    assert.ok(render(T.TasksView, props).includes('导出'))
    const reviews = render(T.ReviewsView, props)
    assert.ok(reviews.includes('等待你决定（1）') && reviews.includes('已阅'))
    const init = render(T.InitView, { cwd: 'D:/t', sessionId: 's', catalog, notify: noop, onDone: noop })
    for (const s of ['要重构的目录', '重构后存放的目录', '浏览…', '重构到', '探测并生成草稿']) assert.ok(init.includes(s), `新建项目缺少：${s}`)
    const chooser = render(T.ProjectChooser, { ctxInfo: { cwd: 'D:/t', bound: true, recent: [{ configFile: 'D:/o/refactorkit.yaml', name: 'DTS', root: 'D:/o', legacyRoot: 'D:/l' }] }, sessionId: 's', notify: noop, onDone: noop, onNew: noop })
    for (const s of ['新建项目…', '打开已有项目', '最近的项目', 'DTS', '解除绑定']) assert.ok(chooser.includes(s), `项目选择缺少：${s}`)
    assert.ok(render(T.ActivityView, props).includes('全部过程'))
    const overview = render(T.OverviewView, props)
    for (const s of ['重构路线', '盘点', '技术选型', '实施', '验证', '收尾', '从这开始']) assert.ok(overview.includes(s), `概览缺少：${s}`)
    const legacyDlg = render(T.DirPicker, { title: '选择要重构的目录', start: 'D:/', mode: 'legacy', onPick: noop, onClose: noop })
    for (const s of ['此电脑', '系统对话框…', '取消', '显示隐藏']) assert.ok(legacyDlg.includes(s), `目录对话框缺少：${s}`)
    assert.ok(!legacyDlg.includes('新建文件夹'), '要重构的目录（只读）不提供新建文件夹')
    assert.ok(render(T.DirPicker, { title: '选择存放目录', start: 'D:/', mode: 'target', onPick: noop, onClose: noop }).includes('新建文件夹'), '存放目录提供新建文件夹')
    assert.deepEqual(JSON.parse(JSON.stringify(T.crumbsOf('D:\\DTS\\DTS-rebuild'))).map((c) => c.path), ['D:\\', 'D:\\DTS', 'D:\\DTS\\DTS-rebuild'])
    assert.ok(render(T.PathField, { label: '② 重构后存放的目录', value: '', onChange: noop, mode: 'target' }).includes('浏览…'))
    assert.ok(render(T.DockButton, { sessionId: 's' }).includes('重构'))
    assert.equal(render(T.DockButton, {}), '', '没有会话时不显示')
    // 系统对话框：Desktop 的 preload 接口优先，其次 Host，都没有时返回 undefined
    sb.__DSH_DIRECTORY_PICKER__ = { pick: async () => 'D:\\DTS\\legacy' }
    assert.equal(await T.pickSystemDirectory(), 'D:\\DTS\\legacy')
    sb.__DSH_DIRECTORY_PICKER__ = { pick: async () => null }
    assert.equal(await T.pickSystemDirectory(), null, '取消返回 null')
    delete sb.__DSH_DIRECTORY_PICKER__
    // Windows Desktop：没有 preload 接口，走官方 uiWorkspace.pickDirectory()
    T.setClientCtx({ get: (n) => (n === 'uiWorkspace' ? { pickDirectory: async () => 'D:\\picked' } : undefined) })
    assert.equal(await T.pickSystemDirectory(), 'D:\\picked')
    T.setClientCtx({ get: () => undefined })
    sb.fetch = async () => ({ ok: true, json: async () => ({ supported: false }) })
    assert.equal(await T.pickSystemDirectory(), undefined)
    sb.fetch = async () => ({ ok: true, json: async () => ({ supported: true, path: 'E:\\x' }) })
    assert.equal(await T.pickSystemDirectory(), 'E:\\x')
    assert.ok(render(T.Panel, { sessionId: 's' }).includes('读取会话'))
  })
})
