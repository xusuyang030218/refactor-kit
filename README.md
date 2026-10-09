# RefactorKit · 自主编排的 DSH 重构插件

> **放开过程，守住结果。**
> 让模型自己决定用哪个技能、要不要分身、分身用哪家模型；插件用代码守住底线（证据、异源审查、真相仲裁、写入范围），并在关键节点请你审核。

状态：**v0.1.0 已实现**，42 项自动化测试通过，已在隔离的真实 DSH 环境中验证加载（13 个工具、14 个技能）｜ 宿主：DeepSeek Harness（DSH）Desktop 2.0.17 ｜ 案例：DTS 重构

## 它解决什么问题

1. **AI 说"完成了"，但实际没完成**。DTS 案例：自报 100%，实测端点覆盖率（估算）15.6%、文件数加权 52.0%。
2. **固定分身拖累强模型**。AiDO 式的岗位分身流程与工具边界都是固定的，强模型被迫在分身之间搬运上下文。

## 核心设计

| 层 | 做法 | 谁决定 |
|---|---|---|
| 技能 | 按需加载的知识卡（迁移坑点、规范、方法），不规定步骤 | 模型 |
| 分身 | 随用随建的临时视角 + 指定模型 + 可选只读，用完即弃 | 模型 |
| 自主度 | `free` / `assisted` / `guided` 三档，按模型自动切换 | 配置 |
| **底线** | 关闭任务必须有证据；仲裁不能是虚报；高风险改动必须经过异源审查；写入范围、命令白名单、不可逆操作审批、账本保护 | **代码强制** |
| 检查强度 | 按改动风险 L0 / L1 / L2 分级，由 diff 事实计算 | **代码计算** |
| **人工审核** | 7 个审核点：项目配置、缺口清单、任务契约、关键决策、审查结果、交付验收、阻塞上报 | **你** |

## 快速开始

### 在 DSH 中使用

```powershell
npm install                      # 唯一依赖：yaml
powershell -ExecutionPolicy Bypass -File scripts\install.ps1         # 安装到当前 DSH profile（会先确认）；之后重启 DSH
```

在 DSH 中打开新系统仓库的会话，输入 **`/refactorkit`**。它会先判断项目状态：
- 未初始化：起草 `refactorkit.yaml`，你在 **CP0** 审核卡中确认；
- 已初始化：告诉你现在在哪、下一步做什么。

### 只用命令行（无 DSH / CI）

```powershell
node bin/rk.mjs init --legacy <老仓> --target <新仓>   # 生成配置草稿
node bin/rk.mjs survey                                 # 盘点
node bin/rk.mjs gaps                                   # 缺口清单
node bin/rk.mjs gate unit                              # 执行门禁并保存证据
node bin/rk.mjs truth --self-reported 1.0              # 自报 vs 实测
node bin/rk.mjs report                                 # 生成看板 .refactorkit/report.html
```

DTS 案例：`node bin/rk.mjs status --cwd examples/dts`

## 工具一览

| 工具 | 作用 | 审核点 |
|---|---|---|
| `rk_status` | 当前状态与下一步 | — |
| `rk_init` | 探测并起草配置 | CP0 |
| `rk_survey` | 盘点新旧仓库 | — |
| `rk_gaps` | 缺口清单、裁撤、手工缺口 | CP1 |
| `rk_task_open` | 打开任务、写验收契约 | CP2 |
| `rk_decide` | 请用户拍板关键决策 | CP3 |
| `rk_delegate` | 临时分身（视角 + 模型 + 只读） | — |
| `rk_review` | 异源审查（自动选不同 provider） | CP4 |
| `rk_gate` | 执行断言 / 门禁，保存证据 | — |
| `rk_truth` | 自报 vs 实测仲裁 | — |
| `rk_task_close` | 底线检查 → 验收 | CP5 / CP6 |
| `rk_note` | 项目记忆 | — |
| `rk_report` | 进度看板 | — |

## 文档

| 文档 | 内容 |
|---|---|
| [docs/01-设计文档.md](./docs/01-设计文档.md) | 完整技术设计 |
| [docs/02-参赛材料映射.md](./docs/02-参赛材料映射.md) | 亚信 1024 黑客松（创意赛道 · 路线 C） |
| [docs/03-AiDO分身分析与吸收.md](./docs/03-AiDO分身分析与吸收.md) | 公司 AiDO 分身分析：保留什么、去掉什么 |
| [docs/04-审核与展示设计.md](./docs/04-审核与展示设计.md) | 人审结果、不审过程：审核点与展示形式 |
| [docs/05-入口设计.md](./docs/05-入口设计.md) | 安装 / 对话 / 项目 / 进度 / 命令行 5 个入口 |
| [docs/06-实现说明与验证记录.md](./docs/06-实现说明与验证记录.md) | **实现与设计的差异、全部验证证据、已知限制** |

## 目录

```text
src/core/      纯函数：配置、盘点、缺口、门禁、证据、风险、底线、账本、审核卡、看板（DSH 与 CLI 共用）
src/app/       应用层：项目与任务操作
src/plugin/    DSH 插件外壳：13 个工具、审核点、守卫、分身、技能注册
skills/        入口技能 refactorkit + 13 个知识技能（项目 .agents/skills 中的同名技能可覆盖）
lenses/        5 张视角卡（项目 .agents/refactorkit/lenses 中的同名文件可覆盖）
templates/     新项目配置模板
examples/dts/  DTS 案例配置
bin/rk.mjs     CLI
scripts/       安装、卸载、自检
tests/         42 项测试（插件测试使用 DSH 真实 defineTool）
```

## 开发

```powershell
npm test         # 全部测试（需要本机安装 DSH Desktop，用于加载真实 defineTool）
npm run test:core
npm run check    # 技能 / 视角卡 / 清单自检
```
