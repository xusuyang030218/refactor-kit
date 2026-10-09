---
name: rk-mybatis-flyway
description: MyBatis-Plus 与 Flyway 迁移脚本的规范和真实事故教训：已发布脚本不可修改、版本号不可复用、方言必须与目标库一致、启动校验失败的排查。
whenToUse: 需要新增或修改表、写 Flyway 迁移脚本、启动时报 Flyway 校验错误、或编写 Mapper 时。只改 Java 业务逻辑时不需要。
---

# MyBatis-Plus 与 Flyway

## Flyway 铁律
1. **已发布（已在任何环境执行过）的 `V` 脚本永远不改**。需要变更就新建更高版本的脚本。
2. **版本号一旦用过就不能再用**，即使原脚本已删除或从未入库。
3. 方言与目标库一致（PostgreSQL：`BIGSERIAL`、`COMMENT ON`、独立 `CREATE INDEX`；不要混入 MySQL 的 `AUTO_INCREMENT`、行内 `COMMENT`）。
4. 幂等补录用 `INSERT ... ON CONFLICT DO NOTHING` 或先判断再插入。

## 真实事故（DTS，提交 bb151fe）
| 现象 | 原因 | 修复 |
|---|---|---|
| 启动报 `Validate failed: Migration checksum mismatch` | 有人在已发布的 V11 中追加了参数行 | V11 还原；参数行放到新脚本 V35 幂等补录 |
| 迁移顺序混乱 | V32 版本号被两个不同脚本使用过 | 新脚本改用未使用过的版本号 V34 |
| PostgreSQL 执行失败 | V33 用了 MySQL 方言 | 改写为 PostgreSQL 方言 |

## 排查 Flyway 启动失败
1. 看报错中的版本号与 checksum。
2. `git log -- <脚本路径>` 看该脚本是否被修改过。
3. 查 `flyway_schema_history` 表中该版本的记录（只读查询）。
4. 修复方案提交前用 `rk_decide` 请用户确认（涉及数据库，属于不可逆操作范畴）。

## MyBatis-Plus
- 实体与表字段对应以迁移脚本为准；逻辑删除、租户字段按项目统一配置。
- 复杂查询放 XML，避免在 Service 中拼字符串 SQL。
- 分页使用分页插件，不要一次查全表。

迁移脚本属于 L2 风险：涉及时关闭任务需要异源审查。
