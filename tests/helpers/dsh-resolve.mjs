import { pathToFileURL } from 'node:url'

let base = ''
export function initialize(data) { base = data.base }

export async function resolve(specifier, context, next) {
  if (specifier.startsWith('@deepseek-ai/')) {
    // 以 DSH node_modules 中的一个虚拟文件为 parent 解析，从而使用其中真实包的 exports
    return next(specifier, { ...context, parentURL: pathToFileURL(`${base}/__rk_resolver__.mjs`).href })
  }
  return next(specifier, context)
}
