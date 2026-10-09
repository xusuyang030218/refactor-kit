// 证据落盘：原始输出按 sha256 去重保存，返回可引用的证据记录。
import { join } from 'node:path'
import { atomicWrite, exists, nowIso, sha256, tail } from './fsx.js'

/**
 * @param {string} stateDir  <targetRoot>/.refactorkit
 * @param {Awaited<ReturnType<typeof import('./gate.js').runGate>>} run
 * @param {{ label?: string }} [meta]
 */
export async function putEvidence(stateDir, run, meta = {}) {
  const body = [
    `# RefactorKit evidence`,
    `label: ${meta.label ?? ''}`,
    `command: ${run.command}`,
    `cwd: ${run.cwd}`,
    `exec: ${run.exec}`,
    `verdict: ${run.verdict}`,
    `exitCode: ${run.exitCode ?? ''}`,
    `durationMs: ${run.durationMs}`,
    `reason: ${run.reason ?? ''}`,
    '',
    '## stdout',
    run.stdout,
    '',
    '## stderr',
    run.stderr,
  ].join('\n')
  const hash = sha256(body)
  const rel = `evidence/${hash}.txt`
  const abs = join(stateDir, rel)
  if (!(await exists(abs))) await atomicWrite(abs, body)
  return {
    id: `ev_${hash.slice(0, 12)}`,
    sha256: hash,
    path: rel,
    exec: run.exec,
    verdict: run.verdict,
    command: run.command,
    cwd: run.cwd,
    ...(run.exitCode !== undefined ? { exitCode: run.exitCode } : {}),
    durationMs: run.durationMs,
    ...(run.reason ? { reason: run.reason } : {}),
    excerpt: tail(`${run.stdout}\n${run.stderr}`.trim(), 2000),
    collectedAt: nowIso(),
  }
}
