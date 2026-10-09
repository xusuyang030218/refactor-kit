// 不可逆操作识别（设计 7.2）：命中即应交给 DSH 审批。识别不到不等于安全。

/** @returns {string | undefined} 命中的规则 */
export function matchIrreversible(command, patterns) {
  if (typeof command !== 'string' || command.trim() === '') return undefined
  return patterns.find((p) => new RegExp(p, 'i').test(command))
}

/** 写类文件工具的名称（宿主内置）。用于账本保护与写入范围守卫。 */
export const WRITE_TOOL_NAMES = new Set(['write', 'edit', 'multi_edit', 'str_replace_editor', 'create', 'apply_patch', 'delete'])

/** 终端类工具的名称。用于不可逆命令识别。 */
export const SHELL_TOOL_NAMES = new Set(['bash', 'pwsh', 'shell', 'terminal'])

/** 从写类工具参数中取目标路径（兼容常见字段名）。 */
export function writeTargetOf(args) {
  if (!args || typeof args !== 'object') return undefined
  return args.file_path ?? args.path ?? args.filePath ?? args.target ?? undefined
}

/** 从终端类工具参数中取命令文本。 */
export function commandOf(args) {
  if (!args || typeof args !== 'object') return undefined
  return typeof args.command === 'string' ? args.command : typeof args.cmd === 'string' ? args.cmd : undefined
}
