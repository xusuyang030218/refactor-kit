// RefactorKit DSH Host 插件入口。
// 只强制依赖 tools；skills / subagents / userQuestions 通过 ctx.get 按需读取，缺失时对应能力降级并给出明确提示。
import { defineTool } from '@deepseek-ai/dsh-tools'
import { registerGuards } from './guards.js'
import { registerSkills } from './skills.js'
import { registerProjectTools } from './tools-project.js'
import { registerTaskTools } from './tools-task.js'
import { registerWeb } from './web.js'

export const name = 'dsh-plugin-refactorkit'
export const inject = ['tools']

/**
 * @param {any} ctx  Cordis Context
 * @param {Record<string, never>} _config  本插件不需要 Host 配置；项目配置在目标仓库的 refactorkit.yaml
 */
export function apply(ctx, _config) {
  registerProjectTools(ctx, defineTool)
  registerTaskTools(ctx, defineTool)
  registerGuards(ctx)
  const { registered, errors } = registerSkills(ctx)
  ctx.logger?.info?.(`refactorkit: 已注册 13 个工具、${registered.length} 个内置技能`)
  for (const e of errors) ctx.logger?.warn?.(`refactorkit: ${e}`)
  // 面板路由：只有存在 webServer（Web / Desktop）时才注册；headless 下自动跳过
  if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], (webCtx) => {
      webCtx.effect(() => registerWeb(webCtx), 'refactorkit: panel routes')
    })
  }
}
