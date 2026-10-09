import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import * as core from '../src/core/index.js'

let tmp
const legacy = () => join(tmp, 'legacy')
const target = () => join(tmp, 'target')

async function put(root, rel, text) {
  await mkdir(join(root, rel, '..'), { recursive: true })
  await writeFile(join(root, rel), text)
}

before(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'rk-core-'))
  await put(legacy(), 'src/main/java/a/ReportController.java', `
@RestController
@RequestMapping("/dts/report")
public class ReportController {
  @GetMapping("/list") public Object list() { return null; }
  @PostMapping(value = "/save") public Object save() { return null; }
  @RequestMapping(value = {"/export/{id}"}, method = RequestMethod.GET) public Object export() { return null; }
}`)
  await put(legacy(), 'src/main/java/a/FlashController.java', `
@Controller
@RequestMapping("/flash")
public class FlashController {
  @GetMapping("/chart") public Object chart() { return null; }
}`)
  await put(legacy(), 'web/js/app.js', 'console.log(1)\n')
  await put(target(), 'server/src/main/java/b/ReportController.java', `
@RestController
@RequestMapping("/api/v1/report")
public class ReportController {
  @GetMapping("/list") public Object list() { return null; } // TODO 分页
  @PostMapping("/save") public Object save() { throw new UnsupportedOperationException(); }
}`)
  await put(target(), 'web/src/views/Report.vue', '<template><div/></template>\n')
  await put(target(), 'web/src/router/index.ts', "export default [{ path: '/report' }]\n")
})

after(async () => { await rm(tmp, { recursive: true, force: true }) })

describe('fsx', () => {
  test('globToRegExp 支持 ** 与任意深度文件名', () => {
    assert.ok(core.matchAny('a/b/db/migration/V1__x.sql', ['**/db/migration/**']))
    assert.ok(core.matchAny('deep/x/y.sql', ['*.sql']))
    assert.ok(core.matchAny('pom.xml', ['pom.xml']))
    assert.ok(core.matchAny('server/pom.xml', ['pom.xml']))
    assert.ok(!core.matchAny('server/src/A.java', ['**/controller/**']))
    assert.ok(core.matchAny('src/x/ReportController.java', ['**/*Controller.java']))
  })
})

describe('survey + gaps + truth', () => {
  test('解析控制器端点（类级前缀、value=、数组、RequestMethod）', () => {
    const c = core.parseJavaController(`@RestController\n@RequestMapping("/x")\nclass A {\n@GetMapping("/a") void a(){}\n@RequestMapping(value = {"/b","/c"}, method = RequestMethod.POST) void b(){}\n}`, 'A.java')
    assert.equal(c.className, 'A')
    assert.deepEqual(c.endpoints.map((e) => `${e.method} ${e.path}`), ['GET /x/a', 'POST /x/b', 'POST /x/c'])
  })

  test('normalizeEndpoint 去掉 /api/v1 与路径参数名', () => {
    assert.equal(core.normalizeEndpoint('/api/v1/report/export/{id}/'), '/report/export/{}')
    assert.equal(core.normalizeEndpoint('dts//Report/List'), '/dts/report/list')
  })

  test('盘点 + 缺口：前缀重构后按尾部两段模糊匹配', async () => {
    const l = await core.surveyRepo(legacy())
    const t = await core.surveyRepo(target())
    assert.equal(l.metrics.controller, 2)
    assert.equal(t.metrics.controller, 1)
    assert.equal(t.vuePages.length, 1)
    assert.deepEqual(t.routes, ['/report'])
    assert.ok(t.placeholders.hits.some((h) => h.kind === 'todo'))
    assert.ok(t.placeholders.hits.some((h) => h.kind === 'not-implemented' && h.severity === 'high'))
    const { gaps, summary } = core.computeGaps(l, t, { retired: [] })
    const report = gaps.find((g) => g.id === 'G-ReportController')
    assert.equal(report.endpoints, 3)
    assert.equal(report.matched, 2)
    assert.equal(report.fuzzy, 2)
    assert.equal(report.status, 'partial')
    assert.equal(gaps.find((g) => g.id === 'G-FlashController').status, 'missing')
    assert.equal(summary.total, 2)
    assert.equal(summary.endpointCoverage, 0.5)
  })

  test('裁撤会从覆盖率分母中移除，并在刷新时保留人工状态', async () => {
    const l = await core.surveyRepo(legacy())
    const t = await core.surveyRepo(target())
    const first = core.computeGaps(l, t, { retired: ['G-FlashController'] })
    assert.equal(first.summary.retired, 1)
    assert.equal(first.summary.endpointCoverage, 0.667)
    const prev = { gaps: first.gaps.map((g) => (g.id === 'G-ReportController' ? { ...g, taskId: 'T-01', note: 'x' } : g)) }
    const again = core.computeGaps(l, t, { previous: prev })
    assert.equal(again.gaps.find((g) => g.id === 'G-FlashController').status, 'retired')
    assert.equal(again.gaps.find((g) => g.id === 'G-ReportController').taskId, 'T-01')
  })

  test('加权完成度与仲裁', () => {
    const w = core.weightedCompletion({ java: 10, controller: 4, vue: 0, js: 100 }, { java: 5, controller: 4, vue: 2, js: 10 }, { java: 0.4, controller: 0.3, vue: 0.2, js: 0.1 })
    assert.equal(w.metrics.vue.rate, 1)
    assert.equal(w.completion, 0.71)
    assert.ok(core.cautions(w).some((c) => c.metric === 'js'))
    const cfg = { falseClaimGap: 0.15, consistentGap: 0.05 }
    assert.equal(core.arbitrate(1, 0.469, cfg).verdict, 'FALSE_CLAIM')
    assert.equal(core.arbitrate(1, 0.97, cfg).verdict, 'CONSISTENT')
    assert.equal(core.arbitrate(0.9, 0.8, cfg).verdict, 'NEEDS_REVIEW')
  })

  test('任务实测：有缺口用覆盖率，无缺口用断言通过比例', () => {
    const gapsDoc = { gaps: [{ id: 'G-A', coverage: 0.5, status: 'partial' }, { id: 'G-B', coverage: 1, status: 'covered' }] }
    assert.equal(core.measureTask({ gapIds: ['G-A', 'G-B'], contract: [] }, gapsDoc).value, 0.75)
    const m = core.measureTask({ gapIds: [], contract: [{ id: 'A1' }, { id: 'A2' }], results: { A1: { verdict: 'pass' } } }, gapsDoc)
    assert.equal(m.basis, 'assertions')
    assert.equal(m.value, 0.5)
  })
})

describe('gate + evidence', () => {
  const allow = ['node -e']
  test('通过、失败、白名单拒绝、期望输出', async () => {
    const ok = await core.runGate({ command: 'node -e "console.log(\'Tests run: 3, Failures: 0\')"', expectPattern: 'Failures: 0' }, { root: tmp, allowlist: allow })
    assert.equal(ok.exec, 'ran')
    assert.equal(ok.verdict, 'pass')
    const bad = await core.runGate({ command: 'node -e "process.exit(2)"' }, { root: tmp, allowlist: allow })
    assert.equal(bad.verdict, 'fail')
    assert.match(bad.reason, /退出码 2/)
    const denied = await core.runGate({ command: 'rm -rf /' }, { root: tmp, allowlist: allow })
    assert.equal(denied.exec, 'denied')
    assert.equal(denied.verdict, 'pending')
    const pattern = await core.runGate({ command: 'node -e "console.log(\'Failures: 1\')"', expectPattern: 'Failures: 0' }, { root: tmp, allowlist: allow })
    assert.equal(pattern.verdict, 'fail')
  })

  test('命令不存在 → env-failed，不算项目失败', async () => {
    const r = await core.runGate({ command: 'rk-definitely-missing-cmd --x' }, { root: tmp, allowlist: ['rk-definitely-missing-cmd'] })
    assert.equal(r.exec, 'env-failed')
    assert.equal(r.verdict, 'pending')
  })

  test('超时 → timeout', async () => {
    const r = await core.runGate({ command: 'node -e "setTimeout(()=>{},10000)"', timeoutMs: 500 }, { root: tmp, allowlist: allow })
    assert.equal(r.exec, 'timeout')
  })

  test('证据按内容去重落盘', async () => {
    const run = await core.runGate({ command: 'node -e "console.log(42)"' }, { root: tmp, allowlist: allow })
    const stateDir = join(tmp, 'state')
    const e1 = await core.putEvidence(stateDir, run, { label: 'A1' })
    assert.match(e1.id, /^ev_[0-9a-f]{12}$/)
    assert.match(await readFile(join(stateDir, e1.path), 'utf8'), /42/)
    const e2 = await core.putEvidence(stateDir, run, { label: 'A1' })
    assert.equal(e1.id, e2.id)
  })
})

describe('risk + irreversible + invariants', () => {
  const rules = core.DEFAULT_RISK
  test('L2：迁移脚本、Controller、diff 中的鉴权、跨模块', () => {
    assert.equal(core.computeRisk({ files: ['server/db/migration/V37__x.sql'], rules }).level, 'L2')
    assert.equal(core.computeRisk({ files: ['server/src/a/ExportController.java'], rules }).level, 'L2')
    const d = core.computeRisk({ files: ['server/src/a/X.java'], diff: '+  StpUtil.checkLogin()', rules })
    assert.equal(d.level, 'L2')
    assert.ok(d.signals.includes('diff:StpUtil'))
    assert.equal(core.computeRisk({ files: ['server/a.txt', 'web/b.txt'], rules }).level, 'L2')
  })
  test('L0 / L1 / 未知', () => {
    assert.equal(core.computeRisk({ files: ['docs/a.md'], rules }).level, 'L0')
    assert.equal(core.computeRisk({ files: ['web/src/a/Svc.ts'], rules }).level, 'L1')
    assert.equal(core.computeRisk({ files: undefined, rules }).level, 'L2')
    assert.equal(core.computeRisk({ files: [], rules }).level, 'L0')
  })
  test('不可逆命令识别', () => {
    const p = core.DEFAULT_IRREVERSIBLE
    assert.ok(core.matchIrreversible('git push origin main', p))
    assert.ok(core.matchIrreversible('pnpm add lodash', p))
    assert.ok(core.matchIrreversible('flyway -url=x migrate', p))
    assert.ok(core.matchIrreversible('psql -c "DELETE FROM t"', p))
    assert.equal(core.matchIrreversible('git diff HEAD', p), undefined)
    assert.equal(core.matchIrreversible('mvn -q test', p), undefined)
  })
  test('底线：L0 只要证据；L2 还要仲裁与异源审查', () => {
    const inv = { requireCrossReview: true, falseClaimGap: 0.15 }
    const task = {
      contract: [{ id: 'A1' }],
      results: { A1: { verdict: 'pass', exec: 'ran' } },
      implementers: [{ provider: 'anthropic', model: 'opus' }],
      reviews: [],
    }
    assert.deepEqual(core.checkInvariants(task, { level: 'L0' }, inv).missing, [])
    const l2 = core.checkInvariants(task, { level: 'L2' }, inv).missing
    assert.equal(l2.length, 2)
    task.truth = { selfReported: 1, measured: 1, verdict: 'CONSISTENT' }
    task.reviews.push({ verdict: 'pass', reviewer: { provider: 'anthropic', model: 'sonnet' } })
    assert.match(core.checkInvariants(task, { level: 'L2' }, inv).missing[0], /同源/)
    task.reviews.push({ verdict: 'pass', reviewer: { provider: 'gpt', model: 'gpt-5.5' } })
    assert.deepEqual(core.checkInvariants(task, { level: 'L2' }, inv).missing, [])
    task.results.A1 = { verdict: 'pending', exec: 'env-failed' }
    assert.match(core.checkInvariants(task, { level: 'L2' }, inv).missing[0], /环境阻塞/)
  })
  test('预算与失败上限', () => {
    const inv = { taskBudget: { tokens: 10, delegations: 1 }, maxFailStreak: 3, maxCloseAttempts: 5 }
    assert.equal(core.overLimits({ usage: { tokens: 5, delegations: 1 }, failStreak: { A1: 2 }, closeAttempts: [] }, inv).length, 0)
    assert.equal(core.overLimits({ usage: { tokens: 50, delegations: 2 }, failStreak: { A1: 3 }, closeAttempts: [] }, inv).length, 3)
  })
})

describe('config + policy + blocks', () => {
  test('配置校验：必填、白名单一致性、底线不可关闭', () => {
    const bad = core.validateConfig(core.deepMerge(core.DEFAULTS, {
      project: { writeScope: [] },
      gates: { x: { command: 'curl evil' } },
      invariants: { requireEvidence: false },
    }))
    assert.ok(bad.some((i) => i.includes('legacyRoot')))
    assert.ok(bad.some((i) => i.includes('writeScope')))
    assert.ok(bad.some((i) => i.includes('commandAllowlist')))
    assert.ok(bad.some((i) => i.includes('requireEvidence')))
  })
  test('parseConfig 解析相对路径并合并默认值', () => {
    const file = join(tmp, 'proj', 'refactorkit.yaml')
    const c = core.parseConfig('project:\n  legacyRoot: ../legacy\n  writeScope: ["src/**"]\ngates:\n  unit: { command: "mvn -q test" }\ncommandAllowlist: ["mvn -q"]\n', file)
    assert.equal(c.project.targetRoot, join(tmp, 'proj'))
    assert.equal(c.project.legacyRoot, join(tmp, 'legacy'))
    assert.equal(c.review.preset, 'standard')
    assert.equal(c.invariants.maxFailStreak, 3)
  })
  test('commandAllowed 按词边界匹配前缀', () => {
    assert.ok(core.commandAllowed('mvn -q test', ['mvn -q']))
    assert.ok(!core.commandAllowed('mvn -qtest', ['mvn -q']))
    assert.ok(!core.commandAllowed('mvnx -q', ['mvn']))
  })
  test('审核策略：预设、按风险、强制阻塞', () => {
    const std = { preset: 'standard' }
    assert.equal(core.resolvePolicy(std, 'CP2', { risk: 'L1' }), 'notify')
    assert.equal(core.resolvePolicy(std, 'CP2', { risk: 'L2' }), 'block')
    assert.equal(core.resolvePolicy(std, 'CP5', { risk: 'L0' }), 'off')
    assert.equal(core.resolvePolicy({ preset: 'light', checkpoints: { CP6: { policy: 'off' } } }, 'CP6'), 'block')
    assert.equal(core.resolvePolicy({ preset: 'light' }, 'CP4', { forceBlock: true }), 'block')
    assert.equal(core.resolvePolicy({ preset: 'strict' }, 'CP5', { risk: 'L0' }), 'block')
  })
  test('审核文件代码块可往返解析', () => {
    const md = `# x\n\n${core.yamlBlock('contract', [{ id: 'A1', statement: 's', check: { gate: 'unit' } }], '注释')}\n`
    assert.deepEqual(core.readYamlBlock(md, 'contract'), [{ id: 'A1', statement: 's', check: { gate: 'unit' } }])
    assert.equal(core.readYamlBlock(md, 'config'), undefined)
    assert.throws(() => core.readYamlBlock('```yaml rk-x\n: : :\n  - [\n```', 'x'), /YAML 有误/)
  })
})

describe('ledger + status + report + detect', () => {
  test('并发更新任务不丢写', async () => {
    const ledger = new core.Ledger(join(tmp, 'ledger', '.refactorkit'))
    await ledger.updateTasks((doc) => { doc.tasks.push({ id: core.nextTaskId(doc), contract: [], n: 0 }) })
    await Promise.all(Array.from({ length: 20 }, () => ledger.updateTask('T-01', (t) => { t.n += 1 })))
    const t = await ledger.getTask('T-01')
    assert.equal(t.n, 20)
    await assert.rejects(() => ledger.updateTask('T-99', () => {}), /找不到任务 T-99/)
    await ledger.journal({ kind: 'delegate', detail: { provider: 'gpt', model: 'm' } })
    assert.equal((await ledger.readJournal()).length, 1)
  })

  test('状态路由：未初始化 → 未盘点 → 就绪 → 进行中', () => {
    assert.equal(core.computeStatus({}).state, 'uninitialized')
    const config = { project: { name: 'p', targetRoot: '/t', legacyRoot: '/l' }, review: { preset: 'standard' } }
    assert.equal(core.computeStatus({ config }).state, 'no-survey')
    const facts = { target: {}, legacy: {} }
    assert.equal(core.computeStatus({ config, facts, gapsDoc: { summary: { missing: 1, partial: 0 } } }).state, 'ready')
    const tasksDoc = { tasks: [{ id: 'T-01', title: 'x', status: 'OPEN', contract: [{ id: 'A1' }], closeAttempts: [{ missing: ['② 缺审查'] }] }] }
    const s = core.computeStatus({ config, facts, tasksDoc })
    assert.equal(s.state, 'in-progress')
    assert.match(s.nextSteps[0], /缺审查/)
    tasksDoc.tasks[0].humanReviews = [{ checkpoint: 'CP2', outcome: 'unanswered', file: 'f' }]
    assert.equal(core.computeStatus({ config, facts, tasksDoc }).state, 'pending-review')
  })

  test('看板 HTML 包含关键区块且转义', () => {
    const html = core.buildReportHtml({
      config: { project: { name: '<p>', targetRoot: '/t', legacyRoot: '/l' }, review: { preset: 'standard' } },
      gapsDoc: { summary: { total: 1, missing: 1, partial: 0, covered: 0, retired: 0, endpointCoverage: 0 }, gaps: [{ id: 'G-A', endpoints: 2, coverage: 0, status: 'missing' }] },
      tasksDoc: { tasks: [{ id: 'T-01', title: 't', status: 'OPEN', contract: [], humanReviews: [{ checkpoint: 'CP2', policy: 'notify', outcome: 'noted', askedAt: '2026-10-09T01:00:00Z' }] }] },
      journal: [{ kind: 'delegate', detail: { provider: 'gpt', model: 'x' } }],
      generatedAt: 'now',
    })
    assert.match(html, /待我审核（1）/)
    assert.match(html, /G-A/)
    assert.match(html, /gpt\/x/)
    assert.ok(!html.includes('<p>进度看板'))
    assert.ok(html.includes('&lt;p&gt;'))
  })

  test('探测：Maven + pnpm workspace + 冒烟脚本 + 写入范围', async () => {
    const root = join(tmp, 'detect')
    await put(root, 'server/pom.xml', '<parent><artifactId>spring-boot-starter-parent</artifactId>\n<version>3.3.5</version></parent>')
    await put(root, 'web/package.json', '{"devDependencies":{"vue":"^3.4.0"}}')
    await put(root, 'web/pnpm-workspace.yaml', 'packages: ["apps/*"]')
    await put(root, 'tests/smoke-test.ps1', 'Write-Output ok')
    await put(root, 'docs/a.md', '#')
    const d = await core.detectProject(root)
    assert.equal(d.stack.find((s) => s.kind === 'maven').springBoot, '3.3.5')
    assert.equal(d.gates.unit.cwd, 'server')
    assert.equal(d.gates['build-fe'].command, 'pnpm -r build')
    assert.equal(d.gates['smoke-test'].sideEffect, true)
    assert.deepEqual(d.writeScope.sort(), ['docs/**', 'server/**', 'tests/**', 'web/**'])
    const draft = core.draftConfig({ legacyRoot: legacy(), detected: d })
    const issues = core.validateConfig(core.deepMerge(core.DEFAULTS, draft))
    assert.deepEqual(issues, [])
  })

  test('审核卡渲染：CP2 带可编辑契约块', () => {
    const task = { id: 'T-01', title: '导出', gapIds: ['G-A'], scope: ['server/**'], contract: [{ id: 'A1', statement: '单测', check: { gate: 'unit' } }], riskEstimate: { level: 'L2', signals: ['scope:x'] }, budget: { tokens: 1, delegations: 1 } }
    const c = core.cardCP2({ task, file: 'f.md' })
    assert.match(c.detail, /预估风险 \*\*L2\*\*/)
    assert.deepEqual(core.readYamlBlock(c.fileContent, 'contract')[0].check, { gate: 'unit' })
  })
})
