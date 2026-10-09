// 审核策略（04 文档第 4 节、05 文档 CP0）：预设 + 覆盖 + 风险 → block / notify / off。

/** 预设表：值可以是策略字符串，或按风险等级的映射。 */
export const PRESETS = {
  strict: { CP0: 'block', CP1: 'block', CP2: 'block', CP3: 'block', CP4: 'block', CP5: 'block', CP6: 'block' },
  standard: {
    CP0: 'block',
    CP1: 'block',
    CP2: { L0: 'notify', L1: 'notify', L2: 'block' },
    CP3: 'block',
    CP4: 'notify',
    CP5: { L0: 'off', L1: 'notify', L2: 'block' },
    CP6: 'block',
  },
  light: {
    CP0: 'block',
    CP1: 'block',
    CP2: 'notify',
    CP3: 'notify',
    CP4: 'notify',
    CP5: { L0: 'off', L1: 'off', L2: 'block' },
    CP6: 'block',
  },
}

/** 不可放宽的审核点：始终 block。 */
const ALWAYS_BLOCK = new Set(['CP0', 'CP6'])

const VALID = new Set(['block', 'notify', 'off'])

/**
 * @param {{ preset?: string, checkpoints?: Record<string, any> }} review  config.review
 * @param {'CP0'|'CP1'|'CP2'|'CP3'|'CP4'|'CP5'|'CP6'} cp
 * @param {{ risk?: 'L0'|'L1'|'L2', forceBlock?: boolean }} [opt]  forceBlock：如 CP1 裁撤、CP4 blocker 不修
 */
export function resolvePolicy(review, cp, opt = {}) {
  if (ALWAYS_BLOCK.has(cp) || opt.forceBlock) return 'block'
  const preset = PRESETS[review?.preset ?? 'standard'] ?? PRESETS.standard
  const override = review?.checkpoints?.[cp]?.policy
  const rule = override ?? preset[cp] ?? 'notify'
  const value = typeof rule === 'string' ? rule : rule[opt.risk ?? 'L2'] ?? 'block'
  return VALID.has(value) ? value : 'block'
}
