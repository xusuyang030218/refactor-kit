---
name: rk-springboot-1x-to-3x
description: Spring Boot 1.5 / 2.x 迁移到 3.x 的坑点清单：javax→jakarta、Spring Security 6 配置、配置属性改名、Actuator、JDK 17+、常见依赖替换。
whenToUse: 迁移老系统后端接口、编译或启动报 javax / Security / 配置相关错误、或评估后端迁移工作量时。
---

# Spring Boot 1.x / 2.x → 3.x

## 必改
| 项 | 老 | 新 |
|---|---|---|
| 包名 | `javax.servlet`、`javax.persistence`、`javax.validation` | `jakarta.*` |
| JDK | 8 | 17+ |
| Security | `WebSecurityConfigurerAdapter` | `SecurityFilterChain` Bean；`authorizeHttpRequests` + `requestMatchers` |
| 路径匹配 | `AntPathMatcher` 默认，尾斜杠匹配 | `PathPatternParser` 默认，**尾斜杠不再自动匹配** |
| 配置属性 | `spring.redis.*`、`server.max-http-header-size` 等 | `spring.data.redis.*`、`server.max-http-request-header-size` |
| Actuator | 端点默认暴露较多 | 默认只暴露 health，需显式开启 |

## 常见依赖替换
- Swagger 2 / springfox → springdoc-openapi
- `commons-lang` → `commons-lang3`；Guava 新版注意 API 删除
- MyBatis-Plus 需升级到支持 Boot 3 的版本（3.5.x）
- 老 JDBC 驱动、`mysql-connector-java` → `mysql-connector-j`

## 行为差异（容易漏测）
- 尾斜杠：`/api/list/` 不再匹配 `/api/list`，前端或网关可能需要调整。
- Jackson 默认配置变化：日期格式、空值处理。
- `@ConstructorBinding` 用法变化；配置类上的位置不同。
- Hibernate 6 的 SQL 方言与 ID 生成策略变化（若使用 JPA）。

## 验证建议
迁移一个 Controller 时，契约至少包含：编译通过（gate compile）、该 Controller 的接口单测、全量单测不退化（gate unit）。
