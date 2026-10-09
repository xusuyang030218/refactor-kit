// 门禁执行：白名单校验 → 运行命令 → 双状态（exec / verdict）判定。证据落盘由 evidence.js 负责。
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { commandAllowed } from './config.js'

const MAX_CAPTURE = 8 * 1024 * 1024

/** 环境类失败的输出特征：命令不存在、权限被拒、沙箱拦截。命中则不算项目失败。 */
const ENV_FAILURE_PATTERNS = [
  /is not recognized as an internal or external command/i,
  /不是内部或外部命令/,
  /command not found/i,
  /spawn\s+\S*\s*E(PERM|NOENT|ACCES)/i,
  /\bEPERM\b.*\bspawn\b/i,
  /JAVA_HOME is not (defined|set)/i,
]

function killTree(child) {
  if (child.pid === undefined) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
  } else {
    try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') }
  }
}

/**
 * 执行一个门禁或断言检查。
 * @param {{ command: string, cwd?: string, expectExit?: number, expectPattern?: string, timeoutMs?: number }} spec
 * @param {{ root: string, allowlist: string[], signal?: AbortSignal, env?: Record<string,string> }} opt
 * @returns {Promise<{ exec: 'ran'|'env-failed'|'timeout'|'denied', verdict: 'pass'|'fail'|'pending', exitCode?: number, durationMs: number, stdout: string, stderr: string, reason?: string, command: string, cwd: string }>}
 */
export function runGate(spec, opt) {
  const command = spec.command.trim()
  const cwd = resolve(opt.root, spec.cwd ?? '.')
  const base = { command, cwd, stdout: '', stderr: '', durationMs: 0 }
  if (!commandAllowed(command, opt.allowlist)) {
    return Promise.resolve({ ...base, exec: 'denied', verdict: 'pending', reason: `命令不在 commandAllowlist 中：${command}` })
  }
  const timeoutMs = spec.timeoutMs ?? 600_000
  const started = Date.now()
  return new Promise((done) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false
    const finish = (r) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      opt.signal?.removeEventListener('abort', onAbort)
      done({ ...base, stdout, stderr, durationMs: Date.now() - started, ...r })
    }
    let child
    try {
      child = spawn(command, {
        cwd,
        shell: true,
        windowsHide: true,
        detached: process.platform !== 'win32',
        env: { ...process.env, ...opt.env, FORCE_COLOR: '0', NO_COLOR: '1' },
      })
    } catch (error) {
      finish({ exec: 'env-failed', verdict: 'pending', reason: `无法启动命令：${error.message}` })
      return
    }
    const onAbort = () => { killTree(child); finish({ exec: 'timeout', verdict: 'pending', reason: '调用被取消' }) }
    opt.signal?.addEventListener('abort', onAbort, { once: true })
    const timer = setTimeout(() => { timedOut = true; killTree(child) }, timeoutMs)
    child.stdout.on('data', (d) => { if (stdout.length < MAX_CAPTURE) stdout += d })
    child.stderr.on('data', (d) => { if (stderr.length < MAX_CAPTURE) stderr += d })
    child.on('error', (error) => finish({ exec: 'env-failed', verdict: 'pending', reason: `命令启动失败：${error.code ?? ''} ${error.message}` }))
    child.on('close', (code) => {
      if (timedOut) return finish({ exec: 'timeout', verdict: 'pending', exitCode: code ?? undefined, reason: `超时（${timeoutMs} ms）` })
      const all = `${stdout}\n${stderr}`
      if (code === 9009 || code === 127 || ENV_FAILURE_PATTERNS.some((re) => re.test(all))) {
        return finish({ exec: 'env-failed', verdict: 'pending', exitCode: code ?? undefined, reason: '运行环境问题（命令不存在、权限被拒或沙箱拦截），不计为项目失败' })
      }
      const expectExit = spec.expectExit ?? 0
      const exitOk = code === expectExit
      const patternOk = spec.expectPattern === undefined || new RegExp(spec.expectPattern, 'm').test(all)
      const reason = exitOk && patternOk ? undefined : [
        exitOk ? undefined : `退出码 ${code}，期望 ${expectExit}`,
        patternOk ? undefined : `输出未匹配 /${spec.expectPattern}/`,
      ].filter(Boolean).join('；')
      finish({ exec: 'ran', verdict: exitOk && patternOk ? 'pass' : 'fail', exitCode: code ?? undefined, ...(reason ? { reason } : {}) })
    })
  })
}
