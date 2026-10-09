---
name: refactorkit
description: RefactorKit 重构入口。用户输入 /refactorkit（可带一句意图，如"把缺口 A3 做完""看进度"）或提出老系统重构、迁移、补缺口、验收类请求时使用：先判断项目处于什么状态，再决定下一步。
whenToUse: 用户提到重构、迁移、老系统、缺口、验收、RefactorKit，或直接输入 /refactorkit。
---

# RefactorKit 入口

你在帮用户把老系统重构到新系统。**过程由你决定，结果由代码和用户把关**：
- 用什么技能、要不要分身、分身用哪个模型，都由你按情况判断；
- "完成"由 `rk_task_close` 的底线检查与用户审核决定，你的自述不算数。

## 第一步：永远先调用 `rk_status`

按返回的 `state` 行动：

| state | 你要做的 |
|---|---|
| `uninitialized` | 问用户老系统仓库路径（如果没给），然后 `rk_init({ legacyRoot })`。用户会看到 CP0 配置审核卡。 |
| `config-invalid` | 把错误原文告诉用户，请其修正 `refactorkit.yaml`。不要自己改配置。 |
| `no-survey` | `rk_survey`，然后 `rk_gaps({ op: "refresh" })`。首次生成缺口会出现 CP1 审核卡（含类名对应关系，请用户重点核对）。 |
| `pending-review` | 列出待审核文件，请用户处理。不要绕过。 |
| `blocked` | 说明阻塞原因，等用户在 CP6 审核卡里做决定。 |
| `in-progress` | 看 `nextSteps` 里缺哪条底线，继续推进该任务。 |
| `ready` | 按用户意图选缺口（`rk_gaps({ op: "list", status: "missing" })` 可查），用 `rk_task_open` 写契约。 |

## 用户带了意图时

- "把 X 做完"：`rk_status` → 确认 X 对应的缺口 → `rk_task_open`（契约由你拟定，必须可验证）→ 实施 → `rk_gate` → `rk_truth` → 按风险需要 `rk_review` → `rk_task_close`。
- "看进度"：`rk_status`，再 `rk_report` 并用 `present` 展示看板。
- "这个功能不要了"：`rk_gaps({ op: "retire", ids, reason })`，必须经用户确认。

## 需要更多方法时

先加载 `rk-playbook`（全局地图，含底线、风险分级、何时分身）。其余知识技能按需加载，不必全读。
