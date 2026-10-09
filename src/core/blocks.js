// 审核文件中的可编辑 YAML 代码块：```yaml rk-<name> … ```。用户直接改文件，"修改后通过"时插件重读。
import YAML from 'yaml'

/** 生成一个带标记的代码块。 */
export function yamlBlock(name, value, comment) {
  const body = YAML.stringify(value, { lineWidth: 0 })
  return `\`\`\`yaml rk-${name}\n${comment ? `# ${comment}\n` : ''}${body}\`\`\``
}

/** 取出指定标记的代码块并解析；不存在返回 undefined；语法错误抛出带行号的信息。 */
export function readYamlBlock(markdown, name) {
  const re = new RegExp('```ya?ml\\s+rk-' + name + '\\s*\\r?\\n([\\s\\S]*?)```', 'm')
  const m = re.exec(markdown)
  if (!m) return undefined
  try {
    return YAML.parse(m[1])
  } catch (error) {
    throw Object.assign(new Error(`审核文件中 rk-${name} 代码块的 YAML 有误：${error.message}`), { code: 'BLOCK_INVALID' })
  }
}

/** 粗略比较两个值，返回人可读的差异摘要（供 log.md / journal）。 */
export function describeChange(before, after) {
  const a = YAML.stringify(before ?? null).split('\n')
  const b = YAML.stringify(after ?? null).split('\n')
  const removed = a.filter((l) => !b.includes(l)).map((l) => `- ${l}`)
  const added = b.filter((l) => !a.includes(l)).map((l) => `+ ${l}`)
  return [...removed, ...added].filter((l) => l.trim() !== '-' && l.trim() !== '+').join('\n')
}
