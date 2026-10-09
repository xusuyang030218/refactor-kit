---
name: rk-gap-judgement
description: 判断缺口与完成度：未迁移 vs 按设计裁撤、四种匹配依据（mapping / name / alias / path）的可信度、文件数口径陷阱、真相仲裁 FALSE_CLAIM 怎么处理。
whenToUse: 解读 rk_gaps 结果、准备裁撤缺口、rk_truth 判为 FALSE_CLAIM 或 NEEDS_REVIEW、或用户质疑完成度数字时。
---

# 缺口与完成度判断

## 匹配依据的可信度（高 → 低）
| basis | 含义 | 可信度 |
|---|---|---|
| mapping | 用户在 CP1 或配置中明确指定的对应关系 | 高 |
| path | 端点路径相同（URL 风格一致时） | 高 |
| name | 规范化后类名相同 | 中：只说明"有同名控制器"，覆盖率按端点数估算 |
| alias | 别名表或拆分后缀（Blur → BlurMask / BlurRule） | 中低 |
| none | 没找到对应 | 可能是未迁移，也可能是改名后没被识别 |

**覆盖率对 name / alias / mapping 是估算值**（新仓端点数 ÷ 老仓端点数）。REST 重设计后一个老接口可能拆成多个、多个合成一个。不要把估算值当成逐个核实的结果。

## 未迁移 vs 按设计裁撤
裁撤的典型理由：技术已淘汰（Flash 图表）、功能被新机制替代（自研登录 → SSO）、调试/示例代码（HelloController）、错误页控制器。
裁撤必须 `rk_gaps({ op: "retire", ids, reason })` 由用户确认，**不要为了提高完成度而裁撤**。

## 口径陷阱
- JS 文件数：老仓未打包的散文件 vs 新仓工程化组件，数量差一个数量级很正常。
- Java 文件数：新系统分层更细或更粗都会影响比率。
- 以端点或功能清单为准，文件数只作参考。

## FALSE_CLAIM 怎么办
1. 不要争辩"其实做完了"。看仲裁依据（关联缺口覆盖率 / 断言通过比例）。
2. 若是匹配没识别出来（basis=none 但其实已实现）：请用户在 CP1 审核文件或 `truth.mapping` 中补上对应关系，再 `rk_gaps refresh`。
3. 若确实没做完：如实把自报完成度降下来，或继续补。
