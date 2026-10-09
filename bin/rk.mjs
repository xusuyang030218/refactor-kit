#!/usr/bin/env node
// RefactorKit 命令行入口（05 文档第 5 节）。与 DSH 插件共用 src/core 与 src/app；不触发审核卡。
import { resolve, join } from 'node:path'
import { parseArgs } from 'node:util'
import { atomicWrite, exists } from '../src/core/index.js'
import { renderConfigYaml } from '../src/core/detect.js'
import { draftForInit, openProject } from '../src/app/project.js'

const HELP = `RefactorKit CLI

用法：node bin/rk.mjs <命令> [选项]

  init   --legacy <老仓> [--target <新仓>] [--name <项目名>] [--out <文件>]
                                                              生成配置草稿（默认 <新仓>/refactorkit.draft.yaml，需人工检查后改名为 refactorkit.yaml）
  status                                                      项目状态与建议下一步
  survey [--target-only]                                      盘点老仓与新仓，写 .refactorkit/facts.json
  gaps                                                        生成/刷新缺口清单，写 .refactorkit/gaps.json
  gate   <门禁名...>                                          执行 refactorkit.yaml 中的命名门禁并保存证据
  truth  --self-reported <0~1>                                 项目级自报 vs 实测仲裁
  report                                                      生成 .refactorkit/report.html

通用选项：--cwd <目录>（默认当前目录）  --json（输出 JSON）`

const pct = (x) => `${(Number(x ?? 0) * 100).toFixed(1)}%`

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      cwd: { type: 'string' }, json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
      legacy: { type: 'string' }, target: { type: 'string' }, name: { type: 'string' },
      'target-only': { type: 'boolean' }, 'self-reported': { type: 'string' }, out: { type: 'string' },
    },
  })
  const [cmd, ...rest] = positionals
  if (!cmd || values.help) { console.log(HELP); return 0 }
  const cwd = resolve(values.cwd ?? values.target ?? process.cwd())
  const out = (human, data) => console.log(values.json ? JSON.stringify(data, null, 2) : human)

  if (cmd === 'init') {
    if (!values.legacy) { console.error('init 需要 --legacy <老系统仓库路径>'); return 2 }
    const { config, detected } = await draftForInit({ targetRoot: cwd, legacyRoot: resolve(values.legacy), name: values.name })
    const file = values.out ? resolve(values.out) : join(cwd, 'refactorkit.draft.yaml')
    await atomicWrite(file, renderConfigYaml(config))
    const exist = await exists(join(cwd, 'refactorkit.yaml'))
    out([
      `已生成草稿：${file}`,
      `技术栈：${detected.stack.map((s) => s.kind).join('、') || '未识别'}`,
      `门禁：${Object.entries(config.gates).map(([n, g]) => `${n}=\`${g.command}\`${g.sideEffect ? '（有副作用）' : ''}`).join('；')}`,
      `写入范围：${config.project.writeScope.join('、')}`,
      exist ? '注意：已存在 refactorkit.yaml，未覆盖。' : '请检查草稿（尤其 slots 占位符、门禁副作用）后改名为 refactorkit.yaml。',
      '在 DSH 中可改用 /refactorkit 或 rk_init，会经过 CP0 审核卡。',
    ].join('\n'), { file, config, detected })
    return 0
  }

  const opened = await openProject(cwd)
  if (opened.error) { console.error(opened.error); return 2 }
  if (!opened.project) {
    if (cmd === 'status') { out('未初始化：当前目录及上级没有 refactorkit.yaml。运行 init 生成草稿。', { state: 'uninitialized' }); return 0 }
    console.error('未找到 refactorkit.yaml。先运行：node bin/rk.mjs init --legacy <老仓>'); return 2
  }
  const p = opened.project

  switch (cmd) {
    case 'status': {
      const s = await p.status()
      out([
        `状态：${s.state}`,
        s.gaps ? `缺口：共 ${s.gaps.total}，缺失 ${s.gaps.missing}，部分 ${s.gaps.partial}，覆盖 ${s.gaps.covered}，裁撤 ${s.gaps.retired}；端点覆盖率 ${pct(s.gaps.endpointCoverage)}` : '缺口：尚未生成',
        `任务：${s.tasks.map((t) => `${t.id}[${t.status}/${t.risk ?? '-'}] ${t.passed}/${t.total}`).join('  ') || '无'}`,
        `待审核：${s.pendingReviews.length}`,
        '下一步：', ...s.nextSteps.map((x) => `  - ${x}`),
      ].join('\n'), s)
      return 0
    }
    case 'survey': {
      const f = await p.survey(values['target-only'] ? 'target' : 'both')
      const m = f.weighted.metrics
      out([
        `老仓 ${f.legacy.root}：${f.legacy.totalFiles} 文件，控制器 ${f.legacy.metrics.controller}，端点 ${f.legacy.endpointCount}（${f.legacy.elapsedMs} ms）`,
        `新仓 ${f.target.root}：${f.target.totalFiles} 文件，控制器 ${f.target.metrics.controller}，端点 ${f.target.endpointCount}，占位 ${f.target.placeholders.count}（${f.target.elapsedMs} ms）`,
        `文件数加权完成度：${pct(f.weighted.completion)}（${Object.entries(m).map(([k, v]) => `${k} ${v.target}/${v.legacy}`).join('，')}）`,
        ...f.weighted.cautions.map((c) => `注意[${c.metric}]：${c.message}`),
      ].join('\n'), { legacy: { ...f.legacy, controllers: undefined }, target: { ...f.target, controllers: undefined }, weighted: f.weighted })
      return 0
    }
    case 'gaps': {
      const doc = await p.refreshGaps()
      const s = doc.summary
      const top = doc.gaps.filter((g) => g.status === 'missing' || g.status === 'partial').sort((a, b) => b.endpoints - a.endpoints).slice(0, 10)
      out([
        `缺口 ${s.total}：缺失 ${s.missing}，部分 ${s.partial}，覆盖 ${s.covered}，裁撤 ${s.retired}，未知 ${s.unknown}；端点覆盖率（估算）${pct(s.endpointCoverage)}（${s.matchedEndpoints}/${s.endpoints}）`,
        `匹配依据：${Object.entries(s.byBasis).map(([k, n]) => `${k} ${n}`).join('，')}（name/alias/mapping 为按端点数估算，需在 CP1 人工确认）`,
        '端点最多的未覆盖缺口：',
        ...top.map((g) => `  ${g.id.padEnd(36)} ${String(g.estMatched).padStart(3)}/${String(g.endpoints).padEnd(4)} ${g.status.padEnd(8)} ${g.basis.padEnd(7)} → ${g.mappedTo.join(',') || '无对应'}`),
      ].join('\n'), doc)
      return 0
    }
    case 'gate': {
      if (rest.length === 0) { console.error(`请给出门禁名。已定义：${Object.keys(p.config.gates).join('、')}`); return 2 }
      const res = await p.runNamedGates(rest)
      out(res.map((r) => `${r.gate}: exec=${r.exec} verdict=${r.verdict} exit=${r.exitCode ?? '-'} ${(r.durationMs / 1000).toFixed(1)}s 证据=${r.id}${r.reason ? ` 原因：${r.reason}` : ''}`).join('\n'), res)
      return res.some((r) => r.verdict === 'fail') ? 1 : 0
    }
    case 'truth': {
      const self = Number(values['self-reported'])
      if (!(self >= 0 && self <= 1)) { console.error('请提供 --self-reported <0~1>'); return 2 }
      const t = await p.projectTruth(self)
      out([
        `自报 ${pct(self)}`,
        `文件数加权实测 ${pct(t.weighted.completion)} → ${t.verdicts.byWeighted.verdict}（差 ${(t.verdicts.byWeighted.gap * 100).toFixed(1)} 个百分点）`,
        t.verdicts.byEndpoints ? `端点覆盖实测 ${pct(t.endpoints.endpointCoverage)} → ${t.verdicts.byEndpoints.verdict}（差 ${(t.verdicts.byEndpoints.gap * 100).toFixed(1)} 个百分点）` : '端点覆盖：尚未生成缺口清单',
      ].join('\n'), t)
      return 0
    }
    case 'report': {
      const file = await p.writeReport()
      out(`已生成看板：${file}`, { file })
      return 0
    }
    default:
      console.error(`未知命令：${cmd}\n\n${HELP}`)
      return 2
  }
}

main().then((code) => { process.exitCode = code }, (error) => { console.error(error.stack ?? error.message); process.exitCode = 1 })
