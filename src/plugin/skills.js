// 内置技能注册：读取插件 skills/<name>/SKILL.md，经 ctx.skills.register 注册（apply 期间同步完成）。
// 项目 .agents/skills 中的同名技能优先（DSH 规则），因此用户可以覆盖任何内置技能。
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'

export const SKILLS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'skills')

const truthy = (v) => v === true || /^(true|yes|on|1)$/i.test(String(v ?? ''))
const falsy = (v) => v === false || /^(false|no|off|0)$/i.test(String(v ?? ''))

/** 解析 SKILL.md：frontmatter + 正文。 */
export function parseSkill(text, path) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
  if (!m) throw new Error(`${path} 缺少 frontmatter`)
  const fm = YAML.parse(m[1]) ?? {}
  if (typeof fm.name !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(fm.name)) throw new Error(`${path} 的 name 必须是 kebab-case`)
  if (typeof fm.description !== 'string' || fm.description.trim() === '') throw new Error(`${path} 缺少 description`)
  return {
    name: fm.name,
    description: fm.description.trim(),
    ...(typeof fm.whenToUse === 'string' ? { whenToUse: fm.whenToUse.trim() } : {}),
    content: m[2].trim(),
    path,
    // DSH 在加载技能正文时要求 source 为字符串（注册时不校验，加载时校验）
    source: 'dsh-plugin-refactorkit',
    invocation: {
      modelInvocable: !truthy(fm['disable-model-invocation']),
      userInvocable: !falsy(fm['user-invocable']),
    },
  }
}

/** 读取全部内置技能；格式错误的条目收集到 errors，不阻断其他技能。 */
export function loadBuiltinSkills() {
  const skills = []
  const errors = []
  let entries = []
  try { entries = readdirSync(SKILLS_DIR, { withFileTypes: true }) } catch { entries = [] }
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const p = join(SKILLS_DIR, e.name, 'SKILL.md')
    try {
      const s = parseSkill(readFileSync(p, 'utf8'), p)
      if (s.name !== e.name) throw new Error(`${p} 的 name（${s.name}）与目录名不一致`)
      skills.push(s)
    } catch (error) {
      errors.push(error.message)
    }
  }
  return { skills: skills.sort((a, b) => a.name.localeCompare(b.name)), errors }
}

/** @param {any} ctx  @returns {{ registered: string[], errors: string[] }} */
export function registerSkills(ctx) {
  const service = ctx.get?.('skills')
  const { skills, errors } = loadBuiltinSkills()
  if (!service?.register) return { registered: [], errors: [...errors, '当前组合没有 skills 服务，跳过内置技能注册'] }
  for (const s of skills) service.register(s)
  return { registered: skills.map((s) => s.name), errors }
}
