---
name: rk-contract-writing
description: 如何为重构任务写可验证的验收契约（rk_task_open 的 contract）：好断言与坏断言对照、如何选检查命令、如何覆盖缺口中的端点。
whenToUse: 准备调用 rk_task_open、用户在 CP2 驳回了契约、或关闭时发现断言不能证明完成时。
---

# 写可验证的契约

## 原则
- **一条断言只证明一件事**，并且能被一条命令判定 pass / fail。
- 契约证明的是"缺口被补上了"，不是"代码编译通过了"。至少要有一条直接针对本任务行为的断言。
- 优先引用 `refactorkit.yaml` 的门禁（`check.gate`）；需要更细粒度时写白名单内的命令。

## 好坏对照
| 坏断言 | 问题 | 好断言 |
|---|---|---|
| "导出功能正常" | 无法用命令判定 | "导出接口返回 xlsx 且含表头" → `mvn -q -Dtest=DataFormExportTest test` |
| `echo ok` | 永远通过，审查会驳回 | 针对新增代码的单测 |
| "前端没问题" | 范围太大 | "DataFormList 页面构建通过" → gate `build-fe` + 一条针对新组件的单测 |
| 只写 `gate: compile` | 只证明能编译 | 加一条测试或接口断言证明行为 |

## 推荐结构（后端接口类缺口）
1. A1 单测：Service 层新增逻辑（正常 / 边界 / 异常三路）
2. A2 接口：Controller 层用 MockMvc 或冒烟脚本验证路径与返回结构
3. A3 回归：`gate: unit` 全量单测不退化
4. A4 前端（如涉及）：`gate: build-fe` 或 `gate: typecheck`

## 覆盖缺口
`rk_gaps list` 里每个缺口有 `missingSample`（老仓端点示例）。契约应说明这些端点在新系统中对应哪里；按设计不再需要的，走 `rk_gaps retire`，不要默默忽略。

## 用户给了意见
在 CP2 审核卡中用户可能直接编辑了契约文件，或写了意见。照意见修改后用 `rk_task_open({ reviseTaskId, contract })` 重新提交。
