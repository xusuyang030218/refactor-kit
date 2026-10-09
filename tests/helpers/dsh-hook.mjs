// 测试用 ESM 解析钩子：把 @deepseek-ai/* 解析到本机 DSH 安装目录，使插件外壳测试使用真实的 defineTool。
// 用法：node --import ./tests/helpers/dsh-hook.mjs --test ...
// DSH 安装目录可用环境变量 DSH_APP_NODE_MODULES 覆盖。
import { register } from 'node:module'

const DEFAULT = 'D:/Users/23074/AppData/Local/Programs/DSH Desktop/resources/app/node_modules'
const base = (process.env.DSH_APP_NODE_MODULES ?? DEFAULT).replace(/\\/g, '/')

register('./dsh-resolve.mjs', import.meta.url, { data: { base } })
