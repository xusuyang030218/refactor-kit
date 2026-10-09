---
name: rk-vue2-to-vue3
description: Vue 2 / jQuery 页面迁移到 Vue 3 + TypeScript 的要点：Options→Composition、Vuex→Pinia、Element UI→Element Plus、jQuery DOM 操作清理、交互五环检查。
whenToUse: 迁移老系统前端页面、处理 Vue 3 编译或类型错误、或检查迁移后的页面交互是否完整时。
---

# Vue 2 / jQuery → Vue 3 + TS

## 对照
| 老 | 新 |
|---|---|
| Options API（data / methods / computed） | `<script setup lang="ts">` + `ref` / `computed` |
| Vuex | Pinia（`defineStore`） |
| Element UI | Element Plus（组件名与属性有变化：`size="mini"` → `size="small"`，`v-model` 绑定方式） |
| `this.$set` / `Vue.set` | 直接赋值（Proxy 响应式） |
| filters | 计算属性或普通函数 |
| `$on` / `$off` 事件总线 | mitt 或 store |
| jQuery DOM 操作、`$.ajax` | 模板绑定 + 统一请求封装 |

## 交互五环（每个交互都检查）
1. 触发：按钮 / 输入 / 路由进入
2. 即时反馈：loading、禁用重复提交
3. 结果呈现：成功提示、列表刷新
4. 异常路径：接口报错、无权限、超时
5. 边界：空数据、超长文本、大数据量分页

## 规范
- 颜色、间距使用项目主题变量，不散落硬编码。
- 复用项目已有的请求封装与状态封装，不另起一套。
- 接口未就绪时可按契约写 mock，但必须标 `TODO(接口对齐)`，且不能作为验收证据。

## 验证建议
页面类缺口的契约：gate typecheck、gate build-fe，加一条针对新组件或 store 的单测（如项目有前端测试框架）。
