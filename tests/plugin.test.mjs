// 插件外壳端到端测试：真实 defineTool + 伪造的 DSH 服务（审核卡、子智能体、技能）。
// 运行：node --import ./tests/helpers/dsh-hook.mjs --test tests/plugin.test.mjs
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'

let plugin
let tmp, target, legacy
const tools = new Map()
const guards = []
const listeners = new Map()
const skillsRegistered = []
const asked = []
let answerQueue = []
const delegations = []

const ctx = {
  logger: { info() {}, warn() {} },
  tools: {
    register(def) { tools.set(def.name, def); return () => tools.delete(def.name) },
    guard(fn) { guards.push(fn); return () => {} },
    schemas() { return [...tools.keys(), 'write', 'edit', 'pwsh', 'read'].map((name) => ({ name })) },
  },
  on(name, fn) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(fn); return () => {} },
  get(name) {
    if (name === 'skills') {
      return {
        register(s) {
          // 与 DSH dsh-skill 加载期校验一致（validateDefinition）：缺字段会在真实加载时失败
          for (const k of ['name', 'description', 'content', 'source']) assert.equal(typeof s[k], 'string', `技能 ${s.name} 缺少字符串字段 ${k}`)
          skillsRegistered.push(s)
          return () => {}
        },
      }
    }
    if (name === 'userQuestions') {
      return {
        async ask(req) {
          asked.push(req)
          const q = req.questions[0]
          assert.ok(q.intent && q.intent.kind === 'plan-review', '审核卡应带 plan-review intent')
          assert.ok(q.options.some((o) => o.label === q.intent.approve), 'approve 必须是选项之一')
          assert.ok(q.detail && q.detail.length > 0)
          const next = answerQueue.shift() ?? { selected: [q.intent.approve] }
          return { answers: [{ id: q.id, ...next }] }
        },
      }
    }
    if (name === 'subagents') {
      return {
        async start(provider, req) {
          delegations.push({ provider, req })
          assert.equal(provider, 'spawn')
          assert.ok(Array.isArray(req.prompt) && req.prompt[0].type === 'text')
          const structured = req.outputSchema ? { verdict: 'pass', findings: [{ severity: 'minor', message: '命名可改进', file: 'a.java', line: 3 }], summary: '契约已兑现' } : undefined
          return {
            id: 's1',
            localAgent: { session: { requestHeader: () => ({ config: { provider: req.agentOptions?.provider ?? 'anthropic', model: req.agentOptions?.model ?? 'opus' } }) } },
            result: Promise.resolve({ output: [{ type: 'text', text: '分身完成' }], structured, stopReason: 'completed' }),
            async dispose() {},
          }
        },
      }
    }
    return undefined
  },
}

const agent = () => ({
  session: { header: { cwd: target, id: 'sess-1' }, requestHeader: () => ({ config: { provider: 'anthropic', model: 'claude-opus-5-5' } }) },
  options: {},
})
let callSeq = 0
const exec = (name, args) => ({ name, arguments: args, callId: `call-${++callSeq}`, signal: new AbortController().signal, agent: agent() })
async function call(name, args = {}) {
  const def = tools.get(name)
  assert.ok(def, `工具 ${name} 未注册`)
  const value = await def.execute(args, exec(name, args))
  const rendered = def.output.render(args, value)
  assert.equal(rendered[0].type, 'text')
  return value
}
const guardReason = (name, args) => { for (const g of guards) { const r = g(exec(name, args)); if (r) return r } return undefined }
async function preExecute(name, args) {
  const ls = listeners.get('tools/pre-execute') ?? []
  let i = 0
  const next = async () => (i < ls.length ? ls[i++](exec(name, args), next) : { kind: 'allow' })
  return next()
}
async function emitResult(name, args, result = { isError: false }) {
  for (const fn of listeners.get('tools/result') ?? []) await fn(exec(name, args), result)
}
const git = (args) => execFileSync('git', args, { cwd: target, stdio: 'pipe' }).toString()

before(async () => {
  plugin = await import('../src/plugin/index.js')
  tmp = await mkdtemp(join(tmpdir(), 'rk-plugin-'))
  target = join(tmp, 'target')
  legacy = join(tmp, 'legacy')
  await mkdir(join(legacy, 'src'), { recursive: true })
  await writeFile(join(legacy, 'src', 'ExportController.java'), '@RestController\n@RequestMapping("/export")\npublic class ExportController {\n@GetMapping("/xlsx") public void a(){}\n@GetMapping("/csv") public void b(){}\n}\n')
  await writeFile(join(legacy, 'src', 'HelloController.java'), '@Controller\npublic class HelloController {\n@GetMapping("/hello") public void a(){}\n}\n')
  await mkdir(join(target, 'server', 'src'), { recursive: true })
  await writeFile(join(target, 'server', 'pom.xml'), '<project/>')
  await writeFile(join(target, 'server', 'src', 'App.java'), 'class App {}\n')
  git(['init', '-q'])
  git(['-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A'])
  git(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init'])
  plugin.apply(ctx, {})
})

after(async () => { await rm(tmp, { recursive: true, force: true }) })

describe('插件注册', () => {
  test('13 个工具全部通过真实 defineTool 的 schema 编译', () => {
    assert.deepEqual([...tools.keys()].sort(), [
      'rk_decide', 'rk_delegate', 'rk_gaps', 'rk_gate', 'rk_init', 'rk_note', 'rk_report', 'rk_review', 'rk_status', 'rk_survey', 'rk_task_close', 'rk_task_open', 'rk_truth',
    ])
    for (const def of tools.values()) {
      assert.equal(def.parameters.type, 'object')
      assert.equal(typeof def.execute, 'function')
    }
  })
  test('内置技能 14 个，入口 /refactorkit 用户可调用', () => {
    assert.equal(skillsRegistered.length, 14)
    const entry = skillsRegistered.find((s) => s.name === 'refactorkit')
    assert.equal(entry.invocation.userInvocable, true)
    assert.ok(entry.content.includes('rk_status'))
  })
  test('真实 defineTool 会拒绝不合法参数', async () => {
    await assert.rejects(() => tools.get('rk_gaps').execute({ op: 'bogus' }, exec('rk_gaps', {})), /invalid arguments/)
  })
})

describe('端到端：初始化 → 盘点 → 缺口 → 任务 → 底线 → 审查 → 验收', () => {
  test('未初始化时 rk_status 指向 rk_init', async () => {
    const v = await call('rk_status')
    assert.equal(v.data.state, 'uninitialized')
    assert.match(v.text, /rk_init/)
  })

  test('rk_init：CP0 用户编辑后通过，写入经校验的配置', async () => {
    // 用户在审核文件中把门禁改成本机可运行的 node 命令（模拟"修改后通过"）
    answerQueue.push({ selected: ['修改后通过'] })
    const realAsk = ctx.get('userQuestions').ask
    const origGet = ctx.get
    ctx.get = (n) => n === 'userQuestions'
      ? { async ask(req) {
        const file = join(target, '.refactorkit', 'review', 'CP0-config.md')
        const text = await readFile(file, 'utf8')
        const YAML = (await import('yaml')).default
        const cfg = YAML.parse(/```yaml rk-config\r?\n([\s\S]*?)```/.exec(text)[1])
        cfg.gates = { unit: { command: 'node -e "process.exit(0)"', kind: 'test' }, compile: { command: 'node -e "console.log(\'BUILD OK\')"', kind: 'build', expectPattern: 'BUILD OK' } }
        cfg.commandAllowlist = ['node -e', 'git diff']
        cfg.slots = { fast: { provider: 'aliyun-maas', model: 'qwen' }, reviewer: { candidates: [{ provider: 'anthropic', model: 'sonnet' }, { provider: 'gpt', model: 'gpt-5.5' }] } }
        cfg.project.writeScope = ['server/**']
        await writeFile(file, text.replace(/```yaml rk-config\r?\n[\s\S]*?```/, `\`\`\`yaml rk-config\n${YAML.stringify(cfg)}\`\`\``))
        return realAsk(req)
      } }
      : origGet(n)
    const v = await call('rk_init', { legacyRoot: legacy, name: '测试项目' })
    ctx.get = origGet
    assert.match(v.text, /已写入/)
    const yaml = await readFile(join(target, 'refactorkit.yaml'), 'utf8')
    assert.match(yaml, /已经过 CP0 审核/)
    assert.match(yaml, /node -e/)
    assert.equal(asked.at(-1).questions[0].header, 'CP0 项目配置')
  })

  test('rk_survey + rk_gaps refresh（CP1 通过）', async () => {
    const s = await call('rk_survey')
    assert.match(s.text, /控制器 2/)
    const g = await call('rk_gaps', { op: 'refresh' })
    assert.equal(g.data.total, 2)
    assert.equal(asked.at(-1).questions[0].header, 'CP1 缺口清单')
  })

  test('rk_gaps retire：用户驳回则不裁撤；通过则裁撤', async () => {
    answerQueue.push({ selected: ['驳回'] })
    const no = await call('rk_gaps', { op: 'retire', ids: ['G-HelloController'], reason: '示例代码' })
    assert.match(no.text, /未裁撤/)
    const yes = await call('rk_gaps', { op: 'retire', ids: ['G-HelloController'], reason: '示例代码' })
    assert.match(yes.text, /已裁撤：G-HelloController/)
  })

  let taskId
  test('rk_task_open：Controller 范围预估 L2 → CP2 阻塞审核；用户给意见 → needs-revision → 修订后通过', async () => {
    answerQueue.push({ selected: [], custom: '加一条编译断言' })
    const contract = [{ statement: '导出单测通过', check: { gate: 'unit' } }]
    const v = await call('rk_task_open', { title: '导出功能', gapIds: ['G-ExportController'], scope: ['server/src/controller/**'], contract })
    taskId = v.data.taskId
    assert.equal(v.data.risk.level, 'L2')
    assert.equal(v.data.contractStatus, 'needs-revision')
    await assert.rejects(() => call('rk_task_close', { taskId, summary: 'x' }), /契约尚未通过 CP2/)
    const r = await call('rk_task_open', { title: '导出功能', reviseTaskId: taskId, contract: [...contract, { statement: '编译通过', check: { gate: 'compile' }, kind: 'build' }] })
    assert.equal(r.data.contractStatus, 'approved')
  })

  test('守卫：账本、老仓、writeScope 外写入被拒；范围内放行', () => {
    assert.match(guardReason('write', { file_path: join(target, '.refactorkit', 'tasks.json') }), /账本由插件管理/)
    assert.match(guardReason('edit', { file_path: join(legacy, 'src', 'ExportController.java') }), /只读/)
    assert.match(guardReason('write', { file_path: 'docs/readme.md' }), /不在 writeScope/)
    assert.equal(guardReason('write', { file_path: 'server/src/controller/ExportController.java' }), undefined)
    assert.equal(guardReason('read', { file_path: join(legacy, 'x') }), undefined)
    // str_replace_editor：view 是只读，不应被拦；create / str_replace 是写入
    assert.equal(guardReason('str_replace_editor', { command: 'view', path: join(legacy, 'src', 'ExportController.java') }), undefined)
    assert.match(guardReason('str_replace_editor', { command: 'str_replace', path: join(legacy, 'src', 'ExportController.java'), old_str: 'a', new_str: 'b' }), /只读/)
    assert.match(guardReason('str_replace_editor', { command: 'create', path: join(target, 'docs', 'x.md'), file_text: '#' }), /不在 writeScope/)
  })

  test('不可逆命令与有副作用门禁会请求审批', async () => {
    const d = await preExecute('pwsh', { command: 'git push origin main' })
    assert.equal(d.kind, 'ask')
    const ok = await preExecute('pwsh', { command: 'git status' })
    assert.equal(ok.kind, 'allow')
  })

  test('实施 → 取证 → 关闭被拒（L2 缺仲裁与异源审查）', async () => {
    await mkdir(join(target, 'server', 'src', 'controller'), { recursive: true })
    await writeFile(join(target, 'server', 'src', 'controller', 'ExportController.java'), '@RestController\n@RequestMapping("/api/v1/export")\npublic class ExportController {\n@GetMapping("/xlsx") public void a(){}\n@GetMapping("/csv") public void b(){}\n}\n')
    await emitResult('write', { file_path: 'server/src/controller/ExportController.java' })
    const g = await call('rk_gate', { taskId })
    assert.ok(g.data.every((r) => r.verdict === 'pass'), JSON.stringify(g.data))
    const c = await call('rk_task_close', { taskId, summary: '实现导出' })
    assert.equal(c.data.closed, false)
    assert.equal(c.data.risk.level, 'L2')
    assert.ok(c.data.missing.some((m) => m.startsWith('③')))
    assert.ok(c.data.missing.some((m) => m.startsWith('②')))
  })

  test('rk_truth 实测覆盖；rk_review 自动跳过同源候选，选 gpt', async () => {
    const t = await call('rk_truth', { taskId, selfReported: 1 })
    assert.equal(t.data.verdict, 'CONSISTENT')
    const r = await call('rk_review', { taskId })
    assert.equal(r.data.verdict, 'pass')
    assert.equal(r.data.reviewer.provider, 'gpt')
    const last = delegations.at(-1)
    assert.equal(last.req.agentOptions.provider, 'gpt')
    assert.ok(last.req.persona.includes('怀疑论'))
    assert.ok(last.req.toolFilter.deny.includes('write'))
  })

  test('底线满足 → CP5 验收通过 → DONE；看板生成', async () => {
    const c = await call('rk_task_close', { taskId, summary: '实现导出' })
    assert.equal(c.data.closed, true, c.text)
    assert.equal(asked.at(-1).questions[0].header, 'CP5 交付验收')
    const s = await call('rk_status')
    assert.equal(s.data.tasks[0].status, 'DONE')
    const rep = await call('rk_report')
    const html = await readFile(rep.data.file, 'utf8')
    assert.match(html, /RefactorKit 进度看板/)
    assert.match(html, /CP5/)
  })

  test('rk_decide：用户选择非推荐方案', async () => {
    answerQueue.push({ selected: ['B 文件'] })
    const v = await call('rk_decide', { question: '模板存哪里？', options: [{ label: 'A 新表', impact: '需迁移', cost: '低' }, { label: 'B 文件', impact: '无迁移', cost: '中' }], recommend: 'A 新表', why: '一致性' })
    assert.equal(v.data.chosen, 'B 文件')
    assert.equal(asked.at(-1).questions[0].options[0].label, 'A 新表', '推荐方案排第一')
  })

  test('rk_delegate：按模型槽路由并计入日志', async () => {
    const v = await call('rk_delegate', { task: '读旧导出逻辑', why: '只要结论', lens: 'archaeologist', slot: 'fast', tools: 'read-only' })
    assert.match(v.text, /aliyun-maas\/qwen/)
    const journal = await readFile(join(target, '.refactorkit', 'journal.jsonl'), 'utf8')
    assert.match(journal, /"kind":"delegate"/)
  })
})
