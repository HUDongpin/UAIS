# UAIS 聊天室功能完整性调查报告

- 调查日期：2026-08-22（Asia/Hong_Kong）
- 调查身份：S10（工具、文档与报告）
- 调查对象：`/learning/chatroom`、相关 API、课程/小组鉴权、AI 编排、持久化、moderation、导出/分享、测试与公开生产入口
- 仓库：`/Volumes/Starship/UAIS`
- 调查方式：只读代码审计、脱敏配置预检、自动化测试、构建、公开生产 GET/HEAD 探测；未修改功能代码、未执行 Git 写操作、未调用付费 AI provider

## 1. 最终结论

**否，当前不能说 UAIS 聊天室“已经完全做出来了”。**

更准确的状态标签是：

> **IMPLEMENTED_MVP / NOT FULLY RELEASE-VERIFIED**
>
> 核心 MVP 已经有真实实现，而且实现面相当完整；但小组聊天室仍未获得当前生产 flag-on 与双用户端到端证据，若按“真实课程里可稳定供师生使用”的标准，尚未完成最终交付。

必须同时看到下面三件事：

1. **不是纯 Mock。** 当前代码已经包含受保护路由、课程/班级/小组鉴权、真人消息持久化、2.5 秒轮询同步、四个可被 `@` 的 AI 助教、LangGraph 编排、DeepSeek/Qwen failover、教师 moderation、PDF 导出、可撤销/过期分享链接和学习记录上报。
2. **本地自动化很强。** 本轮聊天室定向测试达到 `338 passed / 6 skipped`，相关源码定向 lint 通过，生产构建通过。
3. **“完全交付”的最后一公里没有证明。** 本地 `UAIS_LEARNING_CHATROOM_GROUPS_MODE` 未启用；现有项目证据明确记载小组房间只做过本地 flag-on smoke、未完成生产 flag flip；本轮没有两个真实账号的生产会话、没有真实 provider 聊天调用、没有真实 Postgres 集成测试，也没有成功完成浏览器 walkthrough。

因此，若问题是“页面和后端代码是否基本写完”，答案是 **大体写完，且不是演示壳**；若问题是“是否可以宣布聊天室已经完整、稳定、生产可用”，答案是 **不可以**。

## 2. 本报告怎样定义“完全做出来”

为了避免把“有代码”“测试通过”“生产可用”混为一谈，本报告采用四层证据：

| 层级 | 判定问题 | 本次状态 |
| --- | --- | --- |
| L1 代码存在 | UI、API、鉴权、AI、存储、导出/分享是否有真实实现 | **强** |
| L2 自动化验证 | 关键正常流、拒绝流、错误流、并发/重试是否有测试 | **强，但 DB/live 项有跳过** |
| L3 本地真实运行 | 真实浏览器、真实账号、真实 provider、真实 DB 是否跑通 | **部分；浏览器环境阻塞，未调用 provider，DB 集成跳过** |
| L4 生产闭环 | 当前部署上两个账号能否共同发言、AI 回答、刷新回读、导出/分享并可恢复 | **未证明** |

只有 L1-L4 都具备同一版本、同一环境、同一时间窗口的证据，才适合使用“完全做出来”这个表述。

## 3. 功能矩阵

| 功能面 | 代码状态 | 本轮验证 | 完整性判断 |
| --- | --- | --- | --- |
| 受保护的聊天室页面 | 已实现 `/learning/chatroom`；未登录跳转登录页 | 生产页面返回 307 到 `/login?from=/learning/chatroom` | **已实现** |
| 课程/班级解析 | 从真实课程与 membership 投影解析；有 demo/no-course/load-failed 状态 | 定向 UI/API 测试通过 | **已实现** |
| 旧版每学生房间 | 不带 `groupId` 时保持 per-student room | API/UI 回归通过 | **已实现** |
| 学习小组共享房间 | `groupId` 房间、成员名册、教师参与、跨成员回读均有实现 | 本地测试与 2026-08-08 本地 flag-on smoke 强；生产 flag-on 未证明 | **代码完成，生产未完成验收** |
| 真人发言 | 普通消息无需 AI，可先持久化并快速返回 | API/UI 测试通过 | **已实现** |
| 多人同步 | 可见标签页每 2.5 秒轮询 GET；隐藏标签页暂停；429 back-off | 多人轮询、跨成员合并测试通过 | **已实现为近实时，不是真正推送式实时** |
| AI mention gate | 只有真实 `@Agent` / 中文别名触发；引用、邮箱式文本与 handle 前缀不会误触发 | mention-gating 测试通过 | **已实现** |
| 四个 AI 助教 | Research TA、Methods Advisor、Math TA、Writing Helper；按 mention 顺序回答 | orchestration/provider failover 测试通过 | **代码完成；本轮未做真实 provider 调用** |
| LangGraph | 实际用 `@langchain/langgraph` 的 `StateGraph`、supervisor 和 agent nodes | orchestration/workflow 测试通过；旧生产日志曾证明过 LangGraph | **已实现；当前聊天室生产链未重验** |
| Provider failover | DeepSeek 与 Qwen 按角色构建 pool；单 provider 缺失/失败时可切换 | failover 测试通过；`.env.local` 脱敏检查显示两类 provider 均 present | **已实现；当前 live 响应未重验** |
| 会话与课程授权 | HttpOnly 签名 app session；课程成员/小组成员/课程教师分层授权 | 未登录生产 API 返回 401；大量拒绝流测试通过 | **已实现** |
| Transcript 持久化 | 本地 JSON、Postgres、external adapter；房间级 key、revision、去重、滚动窗口 | store/contract 测试通过；真实 Postgres 文件跳过 6 项 | **代码完成，真实 DB 证据缺失** |
| 消息交付诚实性 | 200 内仍读取 transcript receipt；未确认消息标记为未送达并可 retry | UI/API 测试通过 | **已实现** |
| 教师 moderation | 隐藏/恢复消息、冻结/解冻房间；教师操作失败不伪报成功 | API/UI 测试通过 | **已实现** |
| PDF/打印导出 | 受同一房间权限约束；服务端生成 PDF；`no-store` | PDF/API 测试与构建通过 | **已实现；生产登录后下载未验** |
| 分享链接 | 随机 capability id、过期、撤销、成员 mint、公开只读 live view、显示名脱敏 | share API/store 测试通过；生产不存在 share 返回 404 | **已实现；真实生产 mint→read→revoke 未验** |
| LRS/xAPI | 已发出 `collaboration.contributed`，且只在消息确认持久化后计入 | 相关实现与回归存在；本轮未做 live LRS | **代码完成，外部 LRS 未验** |
| 中英双语/主题/a11y | bilingual copy、`role="log"`、`aria-live`、reduced-motion class、dark tokens | 自动化覆盖部分；真实浏览器 walkthrough 阻塞 | **实现较好，人工验收未完成** |
| 生产运维 | readiness、health、trace id、超时预算、错误分类、Sentry 路径均存在 | 公开探测部分通过，但没有已登录 E2E | **未形成完整生产闭环证据** |

## 4. 关键代码证据

### 4.1 小组房间是 dark launch，不是默认开启

`src/lib/server/learning-chatroom-groups-flag.ts:1-33` 明确规定：

- 环境变量为 `UAIS_LEARNING_CHATROOM_GROUPS_MODE`；
- 只有显式值 `on` 才启用；
- 未设置、空值、`true`、`1`、`yes` 或拼写错误都会保持关闭；
- API、课程投影、分享与导出共用这个 reader。

本轮用仓库自带的脱敏 readiness 脚本读取 `.env.local`，结果为：

- `valuePresent: false`
- `enabled: false`
- `blockedReasons: ["groups-mode-not-on"]`

这证明**当前本机配置没有打开真正的学习小组聊天室**。旧版 per-student 房间不受影响，但“人类-AI 小组协作聊天室”不能据此称为当前已启用。

### 4.2 多人同步已经实现，但采用 2.5 秒轮询

`src/components/pages/use-learning-chatroom.ts:85-94` 把同步间隔定义为 `2500ms`；`src/components/pages/use-learning-chatroom.ts:664-672` 通过 `setInterval` 周期读取房间。

优点：

- 普通消息先持久化，其他成员通常在约 2.5 秒内看见；
- 隐藏标签页暂停；
- 对 429 有 back-off；
- 轮询返回会合并同一 message id，避免重复；
- 能更新 freeze 状态、交付状态和 agent round 状态。

限制：

- 没有 WebSocket、SSE 或消息队列推送；
- 不提供 presence、typing indicator 或严格实时顺序保证；
- 每个打开的房间会持续消耗 GET 授权与存储读预算。

如果产品标准接受“数秒内近实时”，这一项可以算完成；如果“聊天室”被定义为即时推送体验，则仍是差距。

### 4.3 AI 并非前端假回复

`src/app/api/learning/chatroom/route.ts:720-736` 在没有 mention 时只持久化真人消息并跳过 agent round；`src/app/api/learning/chatroom/route.ts:739-758` 构建真实 provider pool；`src/app/api/learning/chatroom/route.ts:826-918` 运行 agent loop 并把同一轮前面 agent 的回答加入后续 agent 上下文；`src/app/api/learning/chatroom/route.ts:954-995` 把 agent turns 与真人消息一起持久化。

`src/lib/ai/orchestration/agent-loop.ts:1,103-212` 直接使用 LangGraph `StateGraph`：

- `supervisor` 决定下一位 agent；
- 每位 agent 有独立 node；
- mention 顺序决定 handoff 顺序；
- `maxAgentTurns` 防止无限循环；
- runtime trace 与 event 输出经过脱敏。

`src/lib/server/learning-chatroom-agent-providers.ts:57-123` 只为已有服务器端 key 的 provider 建立 client；DeepSeek 与 Qwen 均可用时形成 failover。`.env.local` 的脱敏检查显示 `text-reasoning` 和 `multimodal` 两个 role 均配置、`failoverAvailable: true`，但本轮没有获得调用付费 provider 的授权，所以**只能确认配置存在与代码/测试链，不能把今天的真实回答质量写成已验证**。

### 4.4 生产 LangGraph 不允许退回内存

`src/lib/ai/langgraph-runtime/runtime.ts:139-176,409-430` 在 production runtime 强制 external persistence；若只剩 `MemorySaver`/`InMemoryStore` 会直接抛错。`src/lib/ai/langgraph-runtime/postgres-persistence.ts:17-60` 支持 `UAIS_LANGGRAPH_PERSISTENCE_BACKEND=postgres|managed`，使用官方 `PostgresSaver` 与 `PostgresStore`。

项目 2026-07-10 的 S22 记录曾证明：

- Production 设置过 `UAIS_LANGGRAPH_PERSISTENCE_BACKEND=postgres`；
- Vercel 构建创建了独立 `uais_langgraph` schema；
- 当时的 production multi-agent probe 返回 200。

但那次证据针对较早的 learning AI guide，不是 2026-08-08 以后增加的小组聊天室完整链路；环境变量也可能漂移。因此它是有价值的历史证据，不是本报告的当前聊天室生产验收。

### 4.5 持久化已经有生产级结构，但本轮缺少真实 DB 集成运行

`src/lib/server/uais-durable-snapshot-backend.ts:20-65` 统一选择 course management、transcript 和 share 的持久化后端：

1. 显式 Postgres/managed；
2. 显式 external；
3. production + core DB ready 时自动 Postgres；
4. 否则 local JSON。

`src/lib/server/learning-chatroom-transcript-runtime.ts:19-71,80-124,194-238,251-273` 提供：

- room-scoped read/write；
- message id 去重；
- moderation 过滤；
- rolling-window disclosure；
- 存储不可用时返回 `unavailable`，不把失败伪装成持久化成功；
- Postgres/external/local adapter 统一入口。

本轮 Postgres store 单元/契约测试通过，但 `tests/learning-chatroom-postgres-integration.test.ts:27-37` 明确在没有可达 `UAIS_CORE_DATABASE_URL` 时跳过。本轮 6 个 skipped case 正来自这一文件，所以没有当前真实数据库上的迁移、并发写、回读和清理证据。

### 4.6 限流存在，但不是全局限流

`src/lib/server/ai-request-rate-limit.ts:1-12` 明确说明 limiter 是 per-process fixed window。在 Vercel 多实例环境中，有效上限约为 `limit × instance count`；冷启动或实例扩缩也会重置进程内计数。

因此：

- “完全没有成本保护”已经修复；
- “全局严格配额、跨实例一致限流”仍未完成。

这对小规模 pilot 可能可接受，对公开大规模课堂或有明确成本上限的部署则不够。

### 4.7 导出、分享与 moderation 不是按钮占位

- `src/lib/chat-actions.ts` 已替换旧 mock export/share helper；
- `/learning/chatroom/export/pdf` 生成 `application/pdf` attachment，并使用 `cache-control: no-store`；
- `/api/learning/chatroom/share` 对创建者、课程、小组 membership、期限和限流做检查；
- `/share/[shareId]` 是 live view，不是冻结截图；撤销、过期、小组删除或 flag 关闭都会停止解析；
- moderation API 对 hide/restore/freeze/unfreeze 做教师课程所有权校验，且失败不会返回伪成功。

这些功能的自动化证据较强，但本轮没有生产登录后真实执行 `mint → signed-out read → revoke → 404` 或 `PDF download`。

## 5. 本轮自动化和运行证据

### 5.1 通过

| 检查 | 结果 |
| --- | --- |
| 聊天室定向 Vitest（15 个文件） | **14 passed / 1 skipped；338 passed / 6 skipped** |
| 相关源码定向 ESLint | **PASS** |
| `npm run build` | **PASS**；Next.js 16.2.9 production build、TypeScript、24 个静态页完成 |
| 构建路由 | 包含 `/learning/chatroom`、history/POST API、moderation、share、export、PDF、public share |
| 远端 main 只读核对 | `refs/heads/main = fd09ef3...` |
| 聊天室源代码与 `origin/main` | 本地领先提交只涉及工具隔离与测试配置；聊天室源码没有本地-only diff |

定向测试覆盖的主要文件：

- `learning-chatroom-api.test.ts`
- `learning-chatroom-group-api.test.ts`
- `learning-chatroom-live.test.tsx`
- `learning-chatroom-group-live.test.tsx`
- `learning-chatroom-mention-gating.test.ts`
- `learning-chatroom-provider-failover.test.ts`
- `learning-chatroom-durable-backend.test.ts`
- `learning-chatroom-postgres-store.test.ts`
- `learning-chatroom-postgres-integration.test.ts`（跳过）
- `learning-chatroom-share-api.test.ts`
- `learning-chatroom-share-external-storage.test.ts`
- `learning-chatroom-transcript-pdf.test.ts`
- `ai-orchestration.test.ts`
- `ai-workflow-graph.test.ts`
- `ai-access-control.test.ts`

### 5.2 未通过、跳过或被环境阻塞

| 检查 | 结果 | 含义 |
| --- | --- | --- |
| `npm run release:clean-check` | **FAIL** | 根目录有大量未跟踪 `.scratch/p2-test-tmp/` 生成物；受跟踪文件本身无改动 |
| 全量 `npm run lint` | **FAIL** | ESLint 误扫描 `.scratch` 中两份故意损坏的 fixture，报 2 个 parsing errors；不是聊天室源文件错误 |
| 全量 `npm run test` | **ABORTED** | Vitest 同样发现 `.scratch` 内复制的测试，运行长期无进展后人工停止；不能声称全套绿色 |
| Postgres integration | **6 SKIPPED** | 当前进程没有可达的 `UAIS_CORE_DATABASE_URL` |
| Playwright headed | **BLOCKED_ENV** | 本机 Chrome 启动后立即被关闭 |
| Playwright headless | **BLOCKED_ENV** | 同样 `TargetClosedError`，未得到页面快照 |
| 真实 provider 调用 | **NOT RUN** | 本轮没有获得 UAIS provider 调用授权；避免产生真实费用或越过 S19/S07 边界 |
| 生产登录后双账号 E2E | **NOT RUN** | 没有本轮授权的生产账号/会话；未输入或读取任何登录秘密 |

全量门禁失败不能归因于聊天室代码，但它影响“仓库已达到可发布状态”的结论。当前本地-only 工具隔离提交忽略了 `.worktrees/**`，却没有忽略 `.scratch/**`，所以当前 root checkout 仍不能给出 clean/full-gate green 证据。

## 6. 当前配置与公开生产探测

### 6.1 `.env.local` 脱敏 readiness

命令：

```text
npm run release:chatroom-readiness -- --env-file .env.local --json
```

只输出存在/缺失状态，不输出任何 key、token、URL 或 cookie。结果：

| 项目 | 状态 |
| --- | --- |
| DeepSeek provider | present |
| DashScope/Qwen provider | present |
| Provider failover | available |
| Group rooms flag | **blocked：未设置 / 未开启** |
| 当前本地 durable selector | unset → local-json |
| 以“production readiness”标准评估 local-json | blocked |

解释：local JSON 在 `next dev` 中可以工作，所以这不等于本地旧版聊天室坏了；它表示这份 `.env.local` 不能作为 production runtime 配置使用，并且小组房间没有打开。

### 6.2 公开生产入口（2026-08-22 本轮即时探测）

| 探测 | 结果 | 能证明什么 | 不能证明什么 |
| --- | --- | --- | --- |
| `https://uais.top/learning/chatroom` | 308 到 `www` | apex 重定向存在 | 聊天功能 |
| `https://www.uais.top/learning/chatroom` | 307 到登录页 | 页面部署且受保护 | 登录后页面可操作 |
| 未登录 GET `/api/learning/chatroom?...` | 401 JSON，带 trace id 与 redaction | API 部署、签名 session gate 生效 | 课程鉴权、存储、AI |
| 不存在的 `/share/<id>` | 404 | public share 路由部署且 unknown-id fail closed | 真实 share mint/read/revoke |
| `/api/ai/readiness`（未登录） | 403 `signed-session-required` | 管理 readiness 未公开泄露 | provider 当前生产状态 |
| `/healthz` 第一次 | 503：DB unreachable / migrations unknown | 健康检查能发现短暂 DB 问题 | 持续故障 |
| `/healthz` 随后两次 | 200：DB ok / migrations ok | core DB 与当前 migration ledger 当时可达 | 长时间稳定性 |
| `/api/external-storage/healthz` | 503 blocked，chatroom storage schema 的 production DB adapter 未配置 | 外部存储服务本身尚未达到生产 ready | 主应用是否选择该 external backend |

生产健康出现过一次 503、随后恢复 200，较像冷启动/连接建立或瞬时可达性问题；本报告不把它夸大为持续宕机，也不能忽略它。聊天室一次 AI round 可持续数十秒，课程鉴权、transcript 和 LangGraph 都依赖数据库，应该在正式验收中专门测冷启动与重复请求。

外部存储 health 的 503 也不能直接等同于主聊天室失败：当前代码在 production + core DB ready 时会自动选 Postgres；只有生产显式 selector 仍指向 `external` 时，这个 503 才是聊天存储的直接 blocker。未登录公开接口无法确认生产 selector。

### 6.3 生产证据的边界

项目历史中存在 2026-07-10 的 Production LangGraph/DeepSeek/Qwen 成功记录；但小组聊天室是在 2026-08-08 才加入。后续 `2026-08-08-chatroom-groups-flag-on-smoke-and-release-readiness.md` 和 `2026-08-08-learning-chatroom-group-qa-matrix.md` 都明确写明：

- flag-on smoke 只在本地执行；
- Vercel deployment smoke 未执行；
- production flag flip 未开始/未证明；
- group flag 默认 off。

本轮没有发现任何更晚的“生产双账号小组聊天室 flag-on E2E”证据。因此不能用 7 月的 AI guide 成功替代 8 月以后聊天室的生产验收。

## 7. 尚未完成的差距，按优先级排序

### P0：没有当前生产小组聊天室 flag-on 证据

这是最大差距。需要证明当前 production/staging 的 `UAIS_LEARNING_CHATROOM_GROUPS_MODE` 是否为 `on`，并用真实课程、真实班级和至少两个学生账号完成跨浏览器消息回读。现有证据只能证明代码和本地 flag-on fixture。

### P0：没有当前生产完整 AI round 证据

必须在同一房间验证：

- 一个不含 mention 的普通真人消息不调用 provider；
- 分别 mention 四个 agent；
- 同一条消息多 mention 时按出现顺序回答；
- 第二位 agent 能看到第一位 agent 的同轮回答；
- DeepSeek/Qwen 当前至少一条真实链成功；
- provider timeout、429、单 provider outage 能正确降级；
- trace id 能在 Vercel 日志中对应到同一请求。

### P0：没有生产双账号协作闭环

需要两个真实浏览器会话证明：A 发普通消息 → B 在 2.5 秒轮询窗口内看到 → B 回复 → A 回读；再验证刷新、切房间、隐藏标签页恢复、断网/429 和 undelivered retry。

### P1：真实 Postgres integration 本轮未跑

至少需要：

- 在隔离数据库应用当前全部 migrations；
- per-room transcript 并发 append；
- revision conflict 重试；
- message id 去重；
- 200/500 条 rolling window；
- moderation 后 export/share 同步过滤；
- share expiry/revoke；
- 服务重启后的持久化回读。

### P1：限流不是跨实例一致的

当前保护足以阻止单进程无限开销，但无法给出严格的全局课堂/租户成本上限。正式开放前应决定：接受 pilot 风险，还是把计数迁移到 Redis/Postgres/KV 并做多实例负载测试。

### P1：当前整仓 full gate 不是绿色

`.scratch/p2-test-tmp/` 污染 test/lint discovery；`release:clean-check` 失败。发布前需要由 S25/S10/S22 按 ownership 处理或隔离这些生成物，然后重新给出：

- clean-check pass；
- full lint pass；
- full test pass；
- build pass；
- 明确的提交 SHA、远端 main 和生产 deployment 绑定。

### P1：浏览器、主题、语言和辅助功能人工验收缺失

本轮 Playwright 环境失败。仍需覆盖：

- Desktop/mobile；
- light/dark；
- zh-CN/en-US；
- keyboard-only；
- screen reader 对 `role=log`、`aria-live`、thinking 状态、错误和 moderation 状态的播报；
- PDF/打印分页和中文字体；
- long message、长成员名、空房间和 500 条窗口。

### P2：产品若要求严格“实时”，需要推送式传输

当前 2.5 秒 polling 是合理 MVP，但不是 WebSocket/SSE。是否升级应由产品标准决定，不应把“即时聊天”默认等同于当前实现。

## 8. 建议的完成验收顺序

1. **先恢复可重复的仓库门禁。** 处理 `.scratch` discovery 污染，得到 clean-check / full lint / full test / build 同一 SHA 的结果。
2. **由 S19 做脱敏 Production env parity。** 只报告变量名与 present/absent/selected mode：app auth、core DB、LangGraph backend、provider keys、group flag、chatroom durable backend；不输出值。
3. **准备隔离的 staging 数据面。** 当前项目明确关闭 preview，原因是 preview 会指向 production DB；在没有独立 staging DB 前，不应为了测试而重新打开普通 preview。
4. **建立最小真实数据。** 一个教师、一个课程、一个班级、两个获批学生、一个小组；使用非敏感测试内容。
5. **执行双浏览器协作矩阵。** 普通消息、四 agent mention、多 mention、跨成员轮询、刷新、切房间、教师 participation、freeze/hide/restore。
6. **执行持久化与公开面。** PDF 下载、share mint、signed-out read、expiry、revoke、group delete/flag off 后 404、LRS event。
7. **执行故障与成本矩阵。** Provider A 失败→B failover、DB 冷启动、transcript unavailable、429、跨实例限流、50 秒 round budget。
8. **绑定发布证据。** 记录 Git SHA、Vercel deployment id、域名、健康检查、已登录 smoke、时间窗口与回滚开关；只有这一套证据全绿后再宣布“完全做出来”。

## 9. 建议对外表述

在上述验收完成前，建议使用：

> UAIS 聊天室的核心 MVP 已实现，包括真实课程/小组鉴权、真人消息、AI 助教编排、持久化、教师 moderation、PDF 导出和可撤销分享。当前仍处于生产验收阶段：小组模式的生产开关、双账号端到端、真实数据库/provider 和跨实例可靠性尚未形成同一版本的完整证据。

不建议使用：

> UAIS 聊天室已经 100% 完成并可全面投入生产。

## 10. 调查边界与未执行操作

- 未修改 `src/`、`tests/`、配置或环境文件；
- 未查看、复制、打印、记录任何真实 credential value；
- 未调用 DeepSeek/Qwen；
- 未登录生产；
- 未 POST/PUT/PATCH/DELETE 生产数据；
- 未 stage、commit、branch、merge、rebase、push、reset、revert 或删除文件；
- 只新增本报告与 S10 session log。
