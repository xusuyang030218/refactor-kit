// 发布前自检：所有模块可导入、技能与视角卡格式正确、清单字段齐全。
// 运行：npm run check   （不需要 DSH；插件入口的导入需要 dsh-hook，见 package.json test 脚本）
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { loadBuiltinSkills } from '../src/plugin/skills.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const problems = []

// 1. core / app / cli 模块可导入（插件入口依赖 @deepseek-ai/dsh-tools，由测试覆盖）
for (const dir of ['src/core', 'src/app']) {
  for (const f of readdirSync(join(root, dir)).filter((x) => x.endsWith('.js'))) {
    try { await import(pathToFileURL(join(root, dir, f)).href) } catch (e) { problems.push(`${dir}/${f} 导入失败：${e.message}`) }
  }
}

// 2. 技能
const { skills, errors } = loadBuiltinSkills()
problems.push(...errors)
for (const s of skills) {
  const lines = s.content.split('\n').length
  if (s.name !== 'refactorkit' && !s.whenToUse) problems.push(`技能 ${s.name} 缺少 whenToUse（模型靠它判断是否加载）`)
  if (lines > 150) problems.push(`技能 ${s.name} 正文 ${lines} 行，超过 150 行软上限，考虑拆分`)
}
if (!skills.some((s) => s.name === 'refactorkit' && s.invocation.userInvocable)) problems.push('缺少用户可调用的入口技能 refactorkit')

// 3. 视角卡
for (const f of readdirSync(join(root, 'lenses'))) {
  const n = readFileSync(join(root, 'lenses', f), 'utf8').trim().split('\n').length
  if (n > 20) problems.push(`视角卡 ${f} 有 ${n} 行，超过 20 行上限`)
}

// 4. 清单
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
if (pkg.dsh?.bundle?.patch !== './cordis.patch.yml') problems.push('package.json 缺少 dsh.bundle.patch')
for (const f of pkg.files ?? []) {
  const p = join(root, f.replace(/\/?\*.*$/, ''))
  try { statSync(p) } catch { problems.push(`package.json files 中的 ${f} 不存在`) }
}

if (problems.length) {
  console.error(`自检发现 ${problems.length} 个问题：\n- ${problems.join('\n- ')}`)
  process.exitCode = 1
} else {
  console.log(`自检通过：${skills.length} 个技能，${readdirSync(join(root, 'lenses')).length} 张视角卡，core/app 模块可导入，清单完整。`)
}
