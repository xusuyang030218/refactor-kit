---
name: rk-evidence-discipline
description: 证据纪律：什么算证据、什么不算；pass / fail / pending 与 exec 状态的区别；禁止模拟证据；环境失败时怎么办。
whenToUse: 关闭任务因"缺少证据"被拒、门禁出现 env-failed / timeout / denied、或想用文字说明代替运行结果时。
---

# 证据纪律

## 只有这些算证据
- `rk_gate` 实际执行命令后保存的原始输出（`.refactorkit/evidence/<sha256>.txt`），含命令、退出码、耗时。
- 证据 id 形如 `ev_xxxxxxxxxxxx`，内容按 sha256 去重，事后可复核。

## 这些不算
- 你的描述："我已经测过了""应该没问题"。
- 历史数字："之前跑过 66/66"——除非本任务重新跑出来。
- 手写或拼接的日志、截图说明、模拟数据。**绝不伪造或模拟证据。**

## 两个状态
| exec | 含义 | verdict |
|---|---|---|
| `ran` | 命令真正跑完 | pass / fail（看退出码与期望输出） |
| `env-failed` | 命令不存在、JDK 缺失、权限或沙箱拦截 | 恒为 pending |
| `timeout` | 超时或被取消 | pending |
| `denied` | 命令不在白名单 | pending |

pending 不能用于关闭任务，也**不算项目失败**。

## 遇到环境失败
1. 把证据中的原因原文告诉用户（如"`mvn` 不是内部或外部命令"）。
2. 不要换一个"能通过"的命令来顶替原断言。
3. 需要换检查方式时，修订契约（`rk_task_open({ reviseTaskId })`），让用户在 CP2 确认。

## 连续失败
同一断言连续失败 3 次后再关闭会转为 BLOCKED。失败两次后先停下来分析输出尾部，必要时 `rk_decide` 或问用户。
