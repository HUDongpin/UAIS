# UAIS P2 落地计划：重要产品质量、UX、a11y 与运维缺口

- 日期：2026-08-21（Asia/Hong_Kong）
- 计划所有者：S10
- 计划状态：Proposed；可直接转成 S01-S25 的分包任务，但不授权任何提交、推送、部署或生产变更
- 范围口径：采用“双层追踪”
  1. 对照 2026-08-16 的旧 P2.1-P2.5；
  2. 以当前工作树和当前部署证据重建真正尚未闭环的 P2。
- 当前 Git 基线：<code>main</code> / <code>origin/main</code> 均为 <code>1b2c1f8</code>。本计划开始时存在的教学工作流与测试 dirty overlay 已由另一会话在计划编写期间提交并推送为该 SHA；当前未提交项只剩本计划和本 S10 日志。该并发变化不等于相关功能已经完成 P2 验收。

---

## 1. 结论先行

旧 P2 的主要功能代码已经进入 <code>main</code>，但 P2 仍不能被宣布完成。当前最明显的缺口不是“功能完全没写”，而是以下四类闭环没有形成：

1. **产品质量证据不足**
   - 关键流程矩阵仍含源代码字符串检查和大量 mock fetch；它不能证明浏览器中的 UI、实际路由、真实数据库和部署配置彼此匹配。
   - 真正的 Postgres 集成测试在没有测试数据库时会跳过；“整套 Vitest 绿色”不能替代数据库路径验证。
   - 本计划开始时的教学 dirty overlay 已在编写期间进入 <code>1b2c1f8</code>；仍需以 S25 intake 和新 SHA 重新绑定证据，避免把“刚合入”直接解释成“已验收”。

2. **UX 仍缺少完整的状态与工作流验收**
   - 旧 P2 中的移动导航、真实身份、诚实错误状态、聊天室安全和教学规模化操作已经实现，但尚未在完整的角色 × locale × 主题 × viewport × 网络状态矩阵中验收。
   - 2026-08-18 教学审计仍记录“修改封面”为启用但无行为的死控件；其他教学候选修复正在未提交工作树中，不能提前算完成。
   - 真实 Week-1 课件发布流程存在，但仓库中没有 <code>data/learning-ppt-playback/&lt;courseId&gt;.json</code> 的已发布真实课程清单；现有内容仍主要依赖编译内置的演示课件和静态资源。

3. **a11y 尚未形成 WCAG 2.2 AA 证据链**
   - <code>docs/performance-accessibility-baseline.md</code> 明确说明它不是完整 Lighthouse、axe 或人工辅助技术审计。
   - 当前测试防止三个关键页面重新落入无法 hydration 的 Suspense 回归，但这只是防回归，不是完整无障碍证明。
   - 尚缺：真实浏览器 axe、键盘全流程、焦点与对话框、缩放与 reflow、对比度、VoiceOver/NVDA、状态通知、媒体替代文本的系统验收。

4. **运维契约存在，但当前运行证明不足**
   - <code>/healthz</code> 已检查数据库和迁移；Sentry、uptime、staging、rollback 文档也存在。
   - 但 preview 分支部署被正确关闭，因为 Preview 环境仍指向生产数据库；因此“preview → staging → production”目前只是一份合同，不是可执行的安全发布通道。
   - 2026-08-21 00:52 HKT 的公开只读探测曾出现一次 <code>503</code>（database unreachable / migrations unknown），随后三次恢复为 <code>200</code>（database ok / migrations ok）。这不能证明持续故障，也不能被忽略；它暴露了告警、SLO、数据库瞬时失败诊断和 soak 证据的缺口。
   - 未找到当前的 provider 控制台 spend cap、Sentry 测试事件、外部 uptime 配置、核心数据库 PITR 恢复演练或 200 人课堂负载证明。

**推荐路线：风险驱动的混合式落地。** 先建立可执行质量门槛和安全 staging，再按用户旅程修复 UX/a11y，最后做真实数据库、负载、恢复和部署证明。不得把“本地测试通过”“提交进入 main”“Vercel Ready”“生产别名已更新”“生产浏览器流程通过”合并成一个状态。

---

## 2. 计划目标与完成定义

### 2.1 P2 的目标

P2 的目标不是继续堆叠功能，而是让 UAIS 的核心教学流程达到以下状态：

- 学生和教师在手机与桌面上能完成关键任务，没有死控件、假数据、无解释禁用、错误身份或无法恢复的错误状态。
- 核心页面达到 WCAG 2.2 AA，并有自动化与人工辅助技术两类证据。
- 关键交互在生产构建中确实 hydration，可操作、可恢复，并满足明确的性能预算。
- 运行团队能发现故障、判断影响、执行回滚或数据恢复，并且不依赖生产环境作为首个全系统测试场。
- 每一项都能追溯到当前源代码、测试、staging 证据、发布 SHA 与生产验证，而不是只依赖计划文字或旧报告。

### 2.2 P2 完成的八条硬标准

只有以下八条全部满足，P2 才可标记完成：

1. **P2 接受台账完整**
   - 每条旧 P2 要求和每条新发现均有唯一 ID、严重度、当前状态、负责人、证据文件、修复 SHA、回滚方式和生产验证状态。
   - 不允许使用“看起来完成”“测试应该覆盖”或旧截图作为状态。

2. **核心旅程真实通过**
   - 登录、入班、审批/拒绝/移除、分组、学习课件、聊天室、教师操作和退出登录均在隔离 staging 以真实路由和真实测试数据库通过。
   - 测试不得把会被真实路由拒绝的请求 mock 成 200。

3. **没有未解释的交互死端**
   - 所有可见按钮、链接、图标按钮、菜单项和表单控件必须满足三选一：
     1. 可用且有成功/失败反馈；
     2. 明确禁用且说明原因及解除条件；
     3. 从核心产品界面移除。
   - “即将上线”只能作为明确标注的非交互信息，不能伪装成可点击控件。

4. **WCAG 2.2 AA 通过**
   - axe 自动审计无 critical/serious 违规。
   - 键盘、焦点、缩放/reflow、对比度、动态状态通知、VoiceOver 和至少一次 NVDA 流程均有人工记录。
   - 自动化 100 分不能替代人工验证。

5. **性能与 hydration 门槛通过**
   - 生产构建中所有纳入矩阵的交互元素均已 hydration，关键点击确实触发预期行为。
   - 移动端 Core Web Vitals 目标：LCP 不高于 2.5 秒、INP 不高于 200 毫秒、CLS 不高于 0.1；staging 无足够 field data 时，先用可重复 lab 测试和基线差异门槛，再在生产 pilot 收集 p75 field data。
   - 不得为追求 bundle 数字重新引入已知会使关键页面失去 hydration 的整页 Suspense/loading 边界。

6. **运维可执行**
   - 有隔离数据库的 staging；Preview 在没有隔离数据库前继续保持关闭。
   - Sentry server/client/source maps、外部 uptime、告警路由和演练均有脱敏实时证据。
   - 核心数据库有已确认的备份/PITR 策略及一次恢复到隔离目标的演练。

7. **课堂规模证据通过**
   - 在 staging 完成 200 个并发入班请求和 40 个房间 × 5 个用户的聊天室负载场景。
   - 最终计数与审计记录必须守恒；不得只检查 HTTP 200。

8. **发布证据同一版本、同一运行批次**
   - lint、unit/integration、真实 DB、build、browser、a11y、performance、load、restore、staging smoke 和生产 smoke 均绑定同一候选 SHA / release-run ID。
   - 推送 <code>main</code> 会自动部署生产并运行迁移，因此只有在 owner 明确授权后才可执行。

---

## 3. 当前证据基线

### 3.1 已确认的仓库事实

| 证据 | 当前结论 | 不能证明什么 |
| --- | --- | --- |
| <code>b87d81a</code> | 批量批准、membership 生命周期、自动分组、真实 QR、随机/过期/停用邀请码已实现 | 不能证明 200 人 staging 负载和辅助技术体验 |
| <code>f3c9f52</code> | 聊天室快速持久化、教师 moderation、分享过期、注入防护已实现 | 不能证明生产 provider、费用上限、真实房间并发或所有导出路径 |
| <code>edc4735</code> | 移动菜单、退出、真实身份与学习记录、双语错误原因映射已实现 | 不能证明所有 viewport/theme/locale/AT 组合 |
| <code>6d524ef</code> | 文件发布课件管线和按真实 courseId 播放已实现 | 仓库中没有真实 courseId JSON 发布清单，也没有当前 release-run 的部署 smoke |
| <code>150c8a2</code> | readiness、healthz、Sentry 静态客户端配置和发布门槛已实现 | 不能证明外部服务实际配置、告警送达或当前生产稳定性 |
| <code>1b2c1f8</code> | 教学审计记录的下载、class 参数、clipboard、QR 等候选修复已提交，相关审计报告已跟踪 | 不能证明当前生产已部署该 SHA，也不能关闭仍需 owner 决策的 course-cover 上传/移除项 |
| 5 个窄测试文件 | 在新 HEAD 上 159/159 tests passed；包含受 <code>1b2c1f8</code> 影响的 teaching-page tests | jsdom 输出 4 次“navigation to another Document not implemented”，且通过仍不是完整真实浏览器/UX/a11y/ops 证明 |
| <code>release:clean-check</code> | 本计划开始时因教学 overlay 失败；并发提交后只会因本计划两份未跟踪文档而失败 | 计划文档未获 Git 操作授权，不能擅自提交来制造 clean 状态 |

### 3.2 旧 P2.1-P2.5 到当前状态的追踪

| 旧包 | 原目标 | 当前判断 | 剩余闭环 |
| --- | --- | --- | --- |
| P2.1 | 200 人入班、membership 生命周期、自动分组、真实 QR、显式课程选择 | **功能已实现，验收未完成** | 真实 DB、200 并发、分组 flag 决策、键盘/移动/双语、跨组一致性、最终数据守恒 |
| P2.2 | 聊天室安全、freeze/hide、share TTL、mention gating、429 恢复 | **功能已实现，运维与真实旅程未完成** | staging 真实房间、教师 moderation、分享撤销/过期、导出过滤、prompt red-team、provider spend cap、负载 |
| P2.3 | 移动导航、退出、auth handoff、dark theme | **功能已实现，跨维度 UX/a11y 未完成** | 320/375/768/1440、light/dark、zh/en、键盘、焦点、滚动保护、session expiry、慢网/离线 |
| P2.4 | 真实课程/课件发布、真实身份与 slide 资源、部署 smoke | **管线已实现，真实课程演练仍缺证据** | 真实持久课程绑定、Week-1 JSON 清单、完整图片/WAV、staging/production smoke、回滚演练 |
| P2.5 | copy/i18n、reason code、aria label、登录提示/同意文案 | **部分实现，完整 a11y 与文案验收未完成** | 可访问名称、状态通知、支持渠道、consent 决策、屏幕阅读器、两种 locale 全旅程 |

### 3.3 并发 intake 事件与当前工作树

本计划开始时，7 个教学/测试 tracked files 与 2 份教学报告构成 dirty overlay。自审期间检测到外部状态变化，重新检查后确认：

- 另一会话将这些路径和 S25 日志提交为 <code>1b2c1f8 fix(teaching): resolve audited teacher workflow defects</code>；
- <code>HEAD</code>、<code>origin/main</code> 当前均为 <code>1b2c1f8</code>；
- 当前 <code>git status</code> 只列出本计划和本 S10 session log 两个未跟踪文件；
- 本 S10 会话没有执行 stage、commit、push、reset、checkout、stash、delete 或 revert。

规则：

- P2-00 应把 <code>1b2c1f8</code> 作为新的 committed baseline，并重跑受影响的教学 acceptance，而不是沿用提交前的 80 项计数。
- 本计划两份文档保持未跟踪，直到 owner 明确授权 Git 操作；不得为得到 clean-check 人为提交。
- 后续每个工作包开始前都必须重新检查 HEAD/status，因为共享工作区可能继续变化。

---

## 4. 三种落地组织方式

### 方案 A：按页面纵向打磨

每个页面 owner 同时负责功能、UX、a11y、测试和运维 smoke。

优点：

- 页面内上下文完整，修复速度快。
- 文件冲突相对容易按 route 隔离。

缺点：

- a11y 和错误状态标准容易分裂。
- 每个 owner 可能重复搭建测试基础设施。
- 运维证据常被推迟到最后。

### 方案 B：先建立横向质量平台

先由 S11/S09/S22 建立 browser、axe、性能和 ops gate，再让页面 owner 修复失败项。

优点：

- 标准一致、证据格式统一。
- 能较早阻止“mock 通过但真实 route 失败”。

缺点：

- 前几天用户看不到产品改善。
- 如果 staging 尚未隔离，质量平台会停在本地。
- 横向团队可能在不了解旅程语义时产生误判。

### 方案 C：风险驱动的混合式路线（推荐）

1. 先做一日的 intake、台账和 stop-the-line 规则；
2. 同时建立最小 browser/axe/staging/observability 基础；
3. 按用户旅程分包修复失败项；
4. 最后做负载、恢复、soak 与生产证据。

选择理由：

- 保留页面 owner 的业务上下文；
- 让所有修复使用同一套验收门槛；
- staging 和运维不是最后一天才发现的阻断项；
- 最适合当前“功能大多已有，但证据和运行闭环不足”的状态。

---

## 5. 执行架构与依赖

### 5.1 关键路径

<code>P2-00 intake</code>
→ <code>P2-10 acceptance harness</code>
→ <code>P2-11 isolated staging</code>
→ <code>P2-20 UX closure</code>
→ <code>P2-30 a11y</code> + <code>P2-40 performance</code>
→ <code>P2-50 observability/recovery</code> + <code>P2-60 load</code>
→ <code>P2-70 integrated release rehearsal</code>

其中：

- P2-10 和 P2-11 可并行；
- 各 route UX 包可并行，但共享文件必须串行；
- P2-30 可在每个 route 包完成后增量运行；
- P2-60 必须等待隔离 staging 和稳定 seed；
- P2-70 必须等待所有 hard gate。

### 5.2 状态词汇

接受台账只能使用：

- <code>not-started</code>
- <code>implemented-unverified</code>
- <code>verified-local</code>
- <code>verified-db-lane</code>
- <code>verified-staging</code>
- <code>ready-for-production</code>
- <code>verified-production</code>
- <code>blocked-owner-decision</code>
- <code>rejected</code>

“已完成”不是一个可单独使用的状态。

### 5.3 建议的 canonical evidence

统一放在 <code>coordination/reports/p2/</code>，每次刷新覆盖 canonical 文件，避免新增大量时间戳副本：

- <code>current-acceptance-ledger.md</code>
- <code>current-browser-matrix.json</code>
- <code>current-a11y-audit.md</code>
- <code>current-performance-budget.json</code>
- <code>current-db-lane.json</code>
- <code>current-load-test.json</code>
- <code>current-observability-readiness.md</code>
- <code>current-restore-drill.md</code>
- <code>current-staging-smoke.json</code>
- <code>current-release-decision.md</code>

证据不得包含真实 cookie、账号、DSN、token、学生内容、私有路径或 provider key。

---

## 6. 工作包

### P2-00：Release intake、基线与接受台账

**目标**

建立一个不会把旧报告、dirty overlay、main 和 production 混淆的单一事实源。

**负责人**

- Lead：S25
- 台账/协调：S10
- 严重度与测试可验证性：S11

**写入范围**

- <code>coordination/release-intake/</code>
- <code>coordination/reports/p2/current-acceptance-ledger.md</code>
- 各自 session log

**任务**

1. 运行带 reason 的 dirty-map，记录所有现有改动的 owner，不做 Git mutation。
2. 以当前 <code>1b2c1f8</code> 为 committed baseline，同时保留本轮并发提交事件附录。
3. 把旧 P2.1-P2.5 拆到可独立验收的 requirement ID。
4. 将 2026-08-18/19 教学审计中的每个缺口标为：
   - 已合入；
   - dirty candidate；
   - 未实现；
   - owner decision；
   - 环境/生产证据缺失。
5. 新发现若涉及安全、数据丢失、权限跨越、生产不可用，立即提升为 P0/P1，不得因为本计划名为 P2 而压低严重度。

**验收**

- 每项都有 owner、文件边界、证据要求和下一个动作。
- 没有把 dirty 文件视为 committed。
- 没有任何 Git stage/commit/branch/push。

**检查**

- <code>npm run release:clean-check</code>：在本计划未被授权提交时会因两份计划文档失败；结果记为准确边界，不伪装为 gate pass。
- <code>npm run release:dirty-map -- --reason "P2 product quality UX a11y operations intake"</code>

**停止条件**

- 出现无法确定 owner 的共享文件。
- dirty overlay 与 P2 计划需要修改同一文件且现有作者未 handoff。

---

### P2-10：真实行为质量测试基础

**目标**

把关键流程矩阵从“源代码包含某字符串 / mock 返回预期值”升级为“真实浏览器调用真实 route 和隔离数据库”。

**负责人**

- Lead：S11
- package/config：S10
- build 与部署 harness：S22
- auth/database fixture：S12

**建议写入范围**

- <code>tests/p2/</code>
- <code>scripts/p2/</code>
- <code>package.json</code> 和 lockfile 仅由 S10 负责
- 不修改 feature UI

**任务**

1. 将 Playwright 固化为项目 dev dependency，不再依赖每次临时 npx 下载。
2. 增加 <code>@axe-core/playwright</code> 或等价固定版本。
3. 建立 staging fixture：
   - 一个教师；
   - 一个 approved 学生；
   - 一个 pending 学生；
   - 一个 rejected/removed 学生；
   - 一个真实 course/class；
   - 两个 group；
   - 一份可回滚测试课件。
4. 建立真实 route/browser contract tests：
   - UI 发出的 URL 必须存在；
   - auth headers/cookies 必须与 route contract 一致；
   - route 403/409/429/503 时 UI 必须显示对应状态；
   - 禁止将 admin-only route mock 为 teacher 200。
5. 将现有 source-text critical-flow matrix 降级为“静态 guard”，另建行为矩阵作为 release gate。
6. 所有 browser 测试输出 trace、console error、failed request 和截图；截图只用虚构 staging 数据。

**建议脚本**

- <code>npm run test:p2:e2e</code>
- <code>npm run test:p2:a11y</code>
- <code>npm run test:p2:db</code>
- <code>npm run test:p2:gate</code>

**验收**

- Playwright/axe 运行时是固定且可复现的。
- 关键流程无 route interception；只允许对第三方 provider 做明确标记的 stub。
- 任何 skipped launch-critical suite 使 P2 gate 失败。
- 浏览器 console error、uncaught exception 或 unexpected failed request 使测试失败。

**停止条件**

- 测试数据库不是隔离实例。
- fixture 需要真实学生资料或生产 cookie。
- package 变更未由 S10/S22 协调。

---

### P2-11：安全 Preview/Staging 通道

**目标**

让 UAIS 有一个不会读写生产数据库的部署验证环境。

**负责人**

- Lead：S22
- env：S19
- database/auth：S12
- runbook：S10

**外部变更**

需要 owner 批准创建或绑定：

- 独立 Vercel staging project 或稳定 staging alias；
- 独立 Neon branch/throwaway Postgres；
- staging 专用 app/teacher session secrets；
- staging 专用 provider scope 或无计费 stub；
- staging Sentry environment/project。

**任务**

1. 在任何 preview 重开之前，先证明 Preview/Staging 的 <code>DATABASE_URL</code>/<code>POSTGRES_URL</code> 不指向生产。
2. 保持 <code>vercel.json</code> 当前 branch deployment disable，直到隔离证明完成。
3. staging 运行 migrations、seed、healthz、auth smoke 和核心旅程。
4. 明确 staging 数据销毁和重置流程。
5. 更新 staging runbook，使文档与实际 Vercel 策略一致。

**验收**

- staging URL、project、database 指纹和 lane marker 可被脱敏证明。
- staging 写入后生产数据库计数不变化。
- <code>/healthz</code> 返回 app/database/migrations 全部 ok。
- production demo auth 在 staging/production 均为 blocked。
- Preview 分支部署只有在独立 DB 已确认后才能重新考虑。

**停止条件**

- staging 与 production 共享可写数据库。
- staging 使用 production cookie/signing secret。
- 需要在聊天或报告中暴露 env 值。

---

### P2-20：产品 UX 与工作流闭环

**Package 写入边界**

| Slice | Primary writer | 允许范围 |
| --- | --- | --- |
| P2-20A | S01 | <code>src/components/layout/</code>、shell 相关 route/layout；copy/CSS 分别交 S09/S06 |
| P2-20B | S02/S03 串行 | course plaza、student dashboard、learning page 及其明确拥有的 route/component |
| P2-20C | S04 | chatroom route/components、<code>src/lib/chat-actions.ts</code>；server contract 交 S12 |
| P2-20D | S05/S13 串行 | teaching page/components 与明确的 teaching subroutes；API contract 交 S12 |

共享 <code>src/i18n/copy.ts</code> 只能由 S09 写，<code>src/app/globals.css</code> 只能由 S06 写，broad tests architecture 只能由 S11 写。任何 slice 都不得顺手重写另一 route。

#### P2-20A：Shell、登录与 session 恢复

**负责人**：S01；文案/可访问名称由 S09；视觉 token 由 S06。

**覆盖**

- Desktop/mobile 导航；
- 退出登录；
- session expired；
- signed-out header；
- route title/announcer；
- light/dark；
- zh-CN/en-US。

**验收**

- 320px 手机可进入学生/教师目标页面并退出。
- 菜单打开后焦点进入；Tab 不逃出；Escape 关闭；关闭后焦点回到触发按钮。
- signed-out 不显示虚构角色或教师身份。
- 过期 session 提供可点击的登录 handoff 和安全 return target。
- theme/locale 切换不重置正在编辑的表单或制造 hydration mismatch。

#### P2-20B：课程广场、Dashboard 与 Learning

**负责人**：S02/S03 分页面；S09 copy；S06 visual；S24 课件资产。

**覆盖**

- no membership、pending、approved、removed；
- no published lesson；
- manifest/audio/image missing；
- event persistence failure；
- offline/retry；
- real displayName/course/teacher；
- no fabricated fallback。

**验收**

- 真实 membership 优先，demo 课程只能明确标注为 sample。
- 未发布课件显示诚实 empty state，不渲染虚构课程或时间戳。
- 所有音频有对应文本内容；播放控制有可访问名称和键盘操作。
- 真实 Week-1 deck 通过 publish <code>--check</code>、staging publish、asset smoke 和 rollback。
- 仓库或持久 data dir 中存在与真实测试 courseId 对应的 manifest；不得只依赖内置 demo。

#### P2-20C：Human-AI Chatroom

**负责人**：S04；S09 copy；S06 visual；server contract 若变化由 S12。

**覆盖**

- plain message zero-spend；
- @mention AI；
- 429 retry/draft restore；
- persist failure/resend；
- teacher freeze/hide/restore；
- share mint/revoke/expire；
- transcript trim notice；
- mobile scroll guard；
- role=log/live-region。

**验收**

- plain message 不触发 provider。
- persist failure 清楚显示未送达，重试不重复计费。
- hide/freeze 同时影响 replay、provider prompt、share 和 export。
- share 到期/撤销后公共页面不可继续读 live data。
- 屏幕阅读器不会因 polling 重复朗读整个线程。
- 375px 下 thread/composer 优先，roster 不把核心对话推到折叠线以下。

#### P2-20D：Teaching

**负责人**：S05/S13；backend S12；测试 S11；从 <code>1b2c1f8</code> 开始重跑 acceptance，并在每次写入前重新确认无人同时修改目标文件。

**当前必查项**

1. “修改封面”死控件：
   - 推荐 P2 决策：先移除或明确禁用，并把上传能力作为单独 S12/S05 feature；
   - 若本期必须上传，则需 mime allowlist、size limit、decode validation、持久资产、signed audit receipt、moderation 决策和测试。
2. 教学审计 80 项全部重跑，不沿用旧计数。
3. grade release/rollback、backup restore、voice revoke 等无 UI caller 的 route：
   - 明确是 operator-only；
   - 或提供安全 UI；
   - 或从产品承诺中移除。
4. group feature flag：
   - pilot 开启：纳入全流程、a11y、负载和 recovery；
   - pilot 关闭：UI/文档必须诚实隐藏，不能广告为可用。
5. admin-only readiness/smoke route 不得重新暴露给教师。

**验收**

- 重新生成的教学功能台账中，所有可见控件都有真实行为或明确禁用解释。
- course/class 参数在导航、标题、请求和回读中一致。
- 任何会产生 side effect 的操作都有 pending、success、failure、retry/rollback 状态。
- 不用 mock 200 证明真实 403 route 可用。

**Package 检查**

- 每个 slice：targeted Vitest + <code>npm run lint</code>。
- route/server-client boundary 变化：<code>npm run build</code>。
- 全部 slice：P2 browser matrix、真实 route contract、两种 locale 和 mobile/desktop。
- Chat/export：保留现有 <code>npm run test</code> 要求。

**停止条件**

- 发现权限、数据一致性或 API shape 需要跨 owner 改动。
- 目标文件出现未 handoff 的并发写入。
- “修 UX”需要降低 auth/admin gate。
- 真实功能需要新 provider、credential 或未批准的外部写操作。

---

### P2-30：WCAG 2.2 AA 与辅助技术验收

**目标**

将 a11y 从零散 aria 属性提升为完整、可追溯的合规与使用体验。

**负责人**

- Lead：S09
- visual/contrast/motion：S06
- automated/manual matrix：S11
- route fixes：各 route owner

**标准**

- WCAG 2.2 AA 为正式目标。
- WAI-ARIA 仅补充原生语义；能使用原生 button/input/dialog 就不造自定义交互。
- 规范依据：[W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/) 与 [Understanding WCAG 2.2](https://www.w3.org/WAI/WCAG22/Understanding/)。

**自动化矩阵**

对以下页面的关键状态运行 axe：

- <code>/login</code>
- <code>/courses</code>
- <code>/student-dashboard</code>
- <code>/learning</code>
- <code>/learning/chatroom</code>
- <code>/learning/chatroom/export</code>
- <code>/teaching</code>
- 每一种 <code>/teaching/[operation]</code> 页面模板
- <code>/share/[shareId]</code>
- <code>/privacy</code>、<code>/terms</code>

状态至少覆盖：

- signed out / expired；
- empty / loading / success / error；
- pending / approved / rejected membership；
- 409 / 429 / 503 / offline；
- dialog open；
- validation error；
- moderation frozen/hidden；
- share expired/revoked。

**人工检查**

1. **Keyboard only**
   - skip link、landmark、heading、Tab 顺序；
   - 无 keyboard trap；
   - 所有菜单、dialog、picker、audio controls 可操作；
   - focus visible 且不被 sticky header/dialog 遮挡。
2. **Screen reader**
   - macOS Safari + VoiceOver 全部核心旅程；
   - Windows Chrome + NVDA 至少一次完整学生和教师旅程；
   - 若 NVDA 环境不可用，状态只能是 blocked-owner/external，不可宣称完成。
3. **Zoom/reflow**
   - 200% 与 400% zoom；
   - 320 CSS px 宽度无双向滚动，数据表等允许的例外需有替代访问方式。
4. **Contrast**
   - 正文至少 4.5:1；
   - 大字和 UI component 至少 3:1；
   - focus indicator 与相邻颜色至少 3:1。
5. **Targets**
   - 交互目标达到 24×24 CSS px，或逐项记录并验证 WCAG 2.2 允许的 spacing/exception；
   - UAIS 主操作产品目标 44×44 CSS px。
6. **Dynamic status**
   - 保存、复制、上传、重试、删除、AI pending、错误必须有适当 live status；
   - 不重复朗读 polling 更新；
   - destructive action 需要明确名称和确认。
7. **Media**
   - PPT 图片有等价标题/outline；
   - narration 有文本；
   - QR 同时提供可复制的邀请码和链接；
   - 不把装饰图错误宣布为内容。
8. **Motion**
   - <code>prefers-reduced-motion</code> 下停止非必要动画；
   - scroll 操作不覆盖用户正在阅读的位置。

**硬 gate**

- axe critical/serious = 0。
- 核心旅程 keyboard blockers = 0。
- screen-reader blocker = 0。
- 所有剩余 moderate/minor 项有 owner、期限和不阻断理由。

**检查**

- <code>npm run test:p2:a11y</code>。
- Playwright keyboard/focus assertions。
- VoiceOver 与 NVDA 人工记录。
- contrast、320px reflow、200%/400% zoom、reduced-motion checklist。

**停止条件**

- 只能在 mock DOM 中复现，无法在 production build 浏览器验证。
- 无 NVDA/等价 Windows AT 环境却准备宣称完整 screen-reader pass。
- 修复需要修改非 S09/S06/route-owner 的共享文件且未协调。

---

### P2-40：性能、hydration 与错误恢复

**目标**

在不重现“SSR 看起来正常但全部控件无事件”的情况下改善真实交互性能。

**负责人**

- QA/measurement：S11
- build/field metrics：S22
- route changes：S01/S02/S03/S04/S05
- CSS/layout：S06

**任务**

1. **Hydration sentinel**
   - 在 production build 上记录每个核心页面的交互元素数量；
   - 对关键控件执行点击/输入，证明 handler 实际运行；
   - 页面不能只依据 server-rendered HTML 被判定通过。
2. **Suspense investigation spike**
   - 单独解释为什么 <code>/learning</code>、<code>/learning/chatroom</code>、<code>/teaching</code> 在整页 Suspense 下不 hydration；
   - 在根因确定前禁止新增 route-level <code>loading.tsx</code>、整页 <code>next/dynamic</code> 或等价边界；
   - 若恢复 loading state，优先使用组件级、可验证边界，并保持 heading/primary shell 可用。
3. **Performance baseline**
   - mobile/desktop，cold/warm，各运行至少 3 次；
   - 记录 LCP、CLS、TBT/lab interaction 和 network bytes；
   - route bundle 不得比批准基线上升超过 10%，除非有书面理由。
4. **Field data**
   - 用 <code>useReportWebVitals</code> 或现有 Vercel Analytics 记录 LCP/INP/CLS；
   - 只记录低内容、无 PII 的 metric。
5. **Resilience**
   - slow 3G/4G、offline、请求超时、409、429、503；
   - retry 必须有幂等边界；
   - 用户输入在可恢复错误中不丢失；
   - AI 慢响应不能阻塞普通 human-to-human message。
6. **Large component control**
   - 当前 learning/chatroom/dashboard 等大型 client modules 只有在行为测试覆盖后才拆分；
   - 以用户工作流为边界，不做无关重构。

**建议门槛**

- 指标定义依据：[Web Vitals](https://web.dev/articles/vitals)；Lighthouse 是 lab signal，需与 field data 分开报告。
- Mobile lab LCP ≤ 2.5s，CLS ≤ 0.1。
- TBT ≤ 200ms 作为 staging lab proxy；生产 field INP p75 ≤ 200ms。
- 关键页面 unexpected console error = 0。
- 关键控件 hydration coverage = 100%。
- 关键请求失败后输入保留/恢复率 = 100%。

**检查**

- production <code>npm run build</code> + <code>npm run start</code>。
- 固定设备/网络参数的 Lighthouse 重复运行。
- Playwright hydration click map。
- Web Vitals lab/field 报告分别归档。

**停止条件**

- 性能优化让任何交互失去 hydration。
- 需要重新引入整页 Suspense/loading 而根因仍未知。
- 优化改变业务语义、auth、持久化或错误诚实性。

---

### P2-50：Observability、SLO、告警与 incident response

**目标**

把“有 Sentry/healthz 代码”变成“故障会被发现、会到达责任人、可判断影响并可恢复”。

**负责人**

- Lead：S22
- env：S19
- database signal：S12
- docs/incident template：S10

**任务**

1. **当前 health anomaly**
   - 记录 2026-08-21 00:52 HKT 的一次 database-unreachable 503 和随后三次 200；
   - 查 Sentry/Vercel/Neon 同时段，区分 cold start、连接池、区域网络、3 秒 probe timeout 或真实数据库故障；
   - 不因后续恢复而删除事件，也不把一次事件直接称为持续 outage。
2. **Sentry live proof**
   - server/client/edge 初始化；
   - source map 可解析；
   - test event 分环境到达；
   - 事件内无 cookie、token、DSN、学生内容或本地路径。
3. **Uptime**
   - 外部 provider 从至少一个亚洲节点监控 <code>/healthz</code>；
   - 若可用，再增加第二地区节点；
   - 记录通知人和升级路径。
4. **建议 SLO**
   - 月度核心服务 availability ≥ 99.9%；
   - pilot 前 24 小时 soak 无连续 health failure；
   - 非 AI 核心 read p95 ≤ 1.5s，write p95 ≤ 2.5s；
   - ordinary API 5xx ≤ 0.5%；
   - chat student-message persistence p95 ≤ 2s；
   - AI round 单独报告，不掩盖普通消息路径。
5. **建议告警**
   - healthz 连续 3 次 503 或 5 分钟内失败率 > 20%：P1；
   - ordinary API 5xx > 2% 持续 5 分钟：P1；
   - DB connection/migration unknown 连续出现：P1；
   - login lockout/401/403 异常突增：P1 安全调查；
   - AI provider 429/5xx、每日成本到 50/80/100%：分级告警；
   - LRS blocked writes：不得静默。
6. **Incident runbook**
   - severity、commander、沟通渠道、证据脱敏、rollback、data recovery、owner notification；
   - 区分应用 deployment rollback 与数据库 restore；
   - 每次演练生成短报告。

**验收**

- test event 和 alert delivery 均有脱敏证明。
- healthz 失败能在规定时间内通知到明确责任人。
- 至少做一次 tabletop：DB unreachable、AI provider 429、session secret misconfiguration。
- runbook 不要求操作员在 incident 中临时搜索私密凭据。

**检查**

- <code>/healthz</code> 多次、跨时间段和至少一个亚洲节点探测。
- Sentry server/client test events 与 source-map symbolication。
- 告警送达演练和 acknowledgment 时间。
- runbook tabletop 记录。

**停止条件**

- 需要读取、打印或写入真实 secret 值到证据。
- 需要更改生产 env、监控 provider 或通知对象但无 owner 授权。
- 当前 503 关联到持续生产事故；此时转 incident protocol，不继续普通 P2 rollout。

---

### P2-60：容量、并发、成本与恢复演练

**目标**

证明 UAIS 在真实课堂规模下不会丢消息、错绑学生、耗尽连接或失控花费。

**负责人**

- Load harness/QA：S11
- database/concurrency：S12
- staging/metrics：S22
- env/provider budgets：S19 + owner
- chat behavior：S04
- enrolment/group behavior：S13/S05

**场景 A：200 人同时入班**

- 200 个虚构 staging account；
- 同一 invite code，在有效期、容量、rate limit 范围内；
- 混合首次提交、重复请求、断线重试；
- 完成后 membership 数、状态、audit log、capacity 必须守恒。

**通过门槛**

- 数据丢失、重复 membership、跨班绑定 = 0。
- unexpected 5xx ≤ 0.5%。
- 409/429 必须符合预期策略并在客户端显示可恢复信息。
- p95 需在预先批准的课堂窗口内；建议 join p95 ≤ 3s。

**场景 B：40 房间 × 5 人，10 分钟**

- 每房间 5 秒 poll；
- human message 与 @mention 混合；
- freeze/hide/share/export 并发；
- provider 可以使用低成本 staging stub；另做少量 live-provider smoke。

**通过门槛**

- plain message provider calls = 0。
- 已确认持久的消息在 replay/share/export 中计数一致。
- hidden message 不进入 share/export/provider prompt。
- DB pool exhaustion、跨房间冲突、silent drop = 0。
- human message persistence p95 ≤ 2s。

**场景 C：AI 成本与限流**

- ai-guide/chat @mention 达到 50/80/100% budget；
- provider 429、timeout、partial failure；
- UI 保留输入，返回明确可恢复状态；
- spend cap 和告警实际触发。

**场景 D：数据恢复**

- 确认生产数据库 PITR/backup policy；
- 从已知时间点恢复到隔离数据库；
- 运行 migration currency、核心计数和抽样 journey；
- 不允许直接对 production 执行 restore drill。

**建议恢复目标**

- RPO ≤ 15 分钟；
- RTO ≤ 60 分钟；
- 若当前 provider 无法满足，必须 owner 明确接受更弱目标，且真实 cohort 上线仍由 privacy/ops gate 决定。

**检查**

- <code>npm run test:p2:db</code>。
- 只指向 staging 的 load harness，并具有 production-host refusal guard。
- 每场景运行前后执行记录计数、哈希/修订与审计守恒检查。
- restore 后运行 migration currency、auth 和核心 journey smoke。

**停止条件**

- 目标 URL、database fingerprint 或 lane marker 不能证明是 staging。
- 测试需要真实学生数据。
- live provider 成本没有 hard cap/owner 批准。
- 发现 silent loss、cross-course leak、cross-room leak 或 pool exhaustion；立即提升 P0/P1。

---

### P2-70：集成验收、soak 与发布决策

**负责人**

- QA sign-off：S11
- deploy/reliability：S22
- git/release intake：S25
- synthesis：S10
- owner：最终授权

**本地/隔离 DB gate**

1. <code>npm run lint</code>
2. <code>npm run test</code>
3. <code>npm run test:critical</code>
4. <code>npm run test:db</code>，必须是真实 throwaway Postgres，skipped = fail
5. <code>npm run build</code>
6. <code>npm run test:p2:e2e</code>
7. <code>npm run test:p2:a11y</code>
8. <code>npm run test:p2:gate</code>
9. <code>npm run release:package-gate</code>，使用明确 pathspec
10. <code>npm run release:clean-check</code>

**staging gate**

- migrations current；
- healthz all ok；
- browser matrix passed；
- a11y passed；
- performance passed；
- load passed；
- restore drill passed；
- Sentry/uptime/alerts passed；
- real Week-1 deck smoke passed；
- 24 小时 soak 无连续 health failure 或未解释 P1。

**production gate**

1. owner 明确授权 push/deploy；
2. 记录 candidate SHA、release-run ID、rollback deployment；
3. 推送 <code>main</code> 前再次确认 migration 与 production DB；
4. Vercel 状态 Ready；
5. alias/DNS 确认；
6. <code>/healthz</code>；
7. signed student/teacher smoke；
8. 课件 manifest + 首张 slide + WAV；
9. chat plain message、@mention、moderation；
10. invite join/approval；
11. Sentry/uptime 无新增 P1；
12. 30-60 分钟观察窗。

**失败策略**

- 任一 hard gate 失败，停止 promotion。
- 不以旧 production evidence 替代新 SHA。
- 不因其他 alias 正常而忽略 <code>www.uais.top</code>。
- 数据/权限问题优先 rollback/feature flag off；不得在 incident 中临时降低 auth gate。

---

## 7. Route × 状态 × 环境验收矩阵

不做不可维护的全笛卡尔积，采用核心状态 + pairwise 组合：

| Journey | Role/state | Viewport | Locale/theme | Network/error | 关键断言 |
| --- | --- | --- | --- | --- | --- |
| Login | signed-out / invalid / locked | 320, 1440 | zh/light, en/dark | normal, 429 | label、错误、consent/support、focus |
| Join course | student / expired | 375, 1440 | zh/dark, en/light | 409, offline | returnTo、input retention、status |
| Dashboard | pending / approved / removed | 375, 1440 | both | 503 | no fake metrics、honest CTA |
| Learning | approved / no lesson | 320, 768, 1440 | both/themes | missing image/audio, offline | honest empty、media alternative |
| Chatroom | student / teacher | 375, 1440 | both | 429, persist fail, poll fail | scroll、draft、moderation、live region |
| Teaching | teacher / expired | 375, 1440 | both/themes | 403, 409, 503 | course/class scope、dead-control policy |
| Share/export | public valid / expired / revoked | 320, 1440 | both | transcript unavailable | noindex、privacy、honest state |
| Legal | public | 320, 1440 | both/themes | normal | headings、links、actual policy match |

每个 journey 必须记录：

- DOM/axe；
- keyboard path；
- focus before/after；
- visible status；
- request URL/status；
- console/uncaught error；
- persistence readback；
- screenshot/trace（仅虚构 staging 数据）。

---

## 8. 三周建议排期

这是在已有 S01-S25 角色内进行的排期，不新增 S26+。

### Wave 0：第 1 个工作日

- P2-00 dirty intake、接受台账、严重度重分级。
- Owner 确认 course-cover、staging、group flag、a11y target。
- 产出明确 pathspec 和一写者规则。

### Wave 1：第 2-4 个工作日

- P2-10 固定 Playwright/axe 与行为矩阵。
- P2-11 建立隔离 staging/database。
- P2-50 配置 Sentry/uptime 测试事件与告警。
- 建立本轮性能和 a11y 基线，不先优化。

### Wave 2：第 5-9 个工作日

- 按 P2-20A-D 修复 UX 和 workflow gaps。
- 每个 route slice 完成后立即跑 a11y/browser，不把问题积到末尾。
- 完成真实 Week-1 deck staging rehearsal。
- 完成 loading/hydration root-cause spike。

### Wave 3：第 10-12 个工作日

- 全量 WCAG 人工检查。
- mobile/desktop performance。
- 200 join + 40-room load。
- PITR/restore drill。
- prompt/cost/rate-limit red-team。

### Wave 4：第 13-15 个工作日

- 统一候选 SHA 的全 gate。
- staging 24 小时 soak。
- S10/S11/S22/S25 汇总 release decision。
- Owner 决定是否授权 production promotion。

**预估**

- 约 15 个工作日；
- 约 25-35 人日，可在共享文件不冲突的前提下并行；
- staging、NVDA 外部环境、provider 控制台和 owner 决策的等待时间不计入工程人日。

---

## 9. Session 分工

| Session | P2 责任 | 主要输出 |
| --- | --- | --- |
| S01 | shell/mobile/auth UX | nav、focus、session recovery |
| S02 | course plaza | membership/join/empty states |
| S03 | learning/dashboard/playback | real-course learning UX |
| S04 | chatroom | transport、moderation、share、mobile |
| S05 | teaching UI | visible operations and dead-control closure |
| S06 | design/CSS | contrast、targets、reflow、motion、dark |
| S08 | shared data semantics | only if acceptance exposes type/invariant gap |
| S09 | copy/i18n/a11y lead | WCAG matrix、localized names/status |
| S10 | plan/config/docs | scripts coordination、runbooks、synthesis |
| S11 | QA lead | Playwright/axe/db/load/release matrix |
| S12 | backend | auth/db/asset/recovery contracts |
| S13 | course operations | membership/groups/invite workflows |
| S19 | env/provider readiness | redacted staging/Sentry/cost caps |
| S22 | staging/deploy/observability | build、health、alerts、soak、rollback |
| S24 | assets/export | real Week-1 deck and media/export quality |
| S25 | git hygiene | dirty map、pathspec、conflict/release intake |

### Shared-file sequencing

- <code>src/i18n/copy.ts</code>：只由 S09 写。
- <code>src/app/globals.css</code>：只由 S06 写。
- <code>tests/</code> broad architecture：S11。
- <code>package.json</code>/<code>package-lock.json</code>：S10。
- build/deploy config：S22，与 S10 协调。
- 教学目标文件：每个工作包开始前重新检查 status/HEAD，并保持一文件一写者。

---

## 10. Owner 决策与推荐默认值

| 决策 | 推荐默认值 | 不决策的影响 |
| --- | --- | --- |
| P2 口径 | 双层追踪 | 可能重复规划已完成工作 |
| a11y 标准 | WCAG 2.2 AA | 无法定义完成 |
| course cover | P2 先移除/禁用死控件；上传另立 feature | 启用死按钮阻断 P2 UX gate |
| staging | 独立 Vercel project + 独立 Neon branch | preview/staging 不可安全运行 |
| group flag | pilot 若使用则 staging/production 均明确 on；否则诚实隐藏 | 无法决定负载和用户承诺范围 |
| Week-1 deck | 选择真实 courseId 和 owner-provided assets 做 rehearsal | P2.4 只能停在 implemented-unverified |
| Sentry/uptime | 确认 provider、通知人和 escalation | observability 不能宣布 ready |
| AI spend caps | DeepSeek/DashScope 控制台 hard cap + 50/80/100% alert | 成本风险未闭环 |
| retention/privacy contact | pilot 前由 institution 记录 | 真实 cohort 仍是 production stop |
| NVDA 环境 | 安排 Windows + Chrome | screen-reader gate 不能完整通过 |

---

## 11. 风险登记

| 风险 | 概率/影响 | 缓解 |
| --- | --- | --- |
| dirty overlay 被误当成 baseline | 高/高 | S25 intake；main 与 overlay 分列 |
| preview 读写生产 DB | 已知/极高 | 未隔离前保持 branch deployment off |
| mock UI tests 掩盖 route auth 失败 | 高/高 | 真实 route/browser contract |
| route-level Suspense 再次让页面不 hydration | 中/极高 | hydration sentinel；先做 root-cause spike |
| a11y 自动化误当人工合规 | 高/中 | VoiceOver/NVDA/keyboard/reflow 必须有人工作证据 |
| 负载测试污染生产 | 中/极高 | 只对 staging isolated DB；明确 base URL guard |
| provider live smoke 产生费用/敏感输出 | 中/中 | 少量批准 smoke、redaction、spend cap |
| healthz 单次 503 被误判或忽略 | 中/高 | 多次采样、日志关联、连续失败告警 |
| 真实 deck 资产不完整 | 高/中 | publish --check、atomic publish、asset smoke |
| package/config 并发修改 | 中/高 | S10/S22 单写者、明确 pathspec |
| P2 吸收法律/新功能无限扩张 | 中/中 | privacy/legal 作为 stop gate；新功能另立包 |

---

## 12. 不在本 P2 内的工作

除非验收发现它们是 core journey 的直接 blocker，以下不纳入：

- 新建 admin console；
- 新增 AI provider；
- 大规模数据库重写；
- 全面 adaptive-learning 产品化；
- 新 analytics dashboard；
- 无测试保护的大型组件重构；
- 为了得到 Preview 而允许其访问 production DB；
- 法律意见本身。

但以下项目仍是 real-cohort stop gate：

- retention schedule、privacy contact、provider approval；
- production demo auth；
- 未证明的 durable storage/backup；
- 未证明的 staging 与 incident route；
- 严重 a11y blocker；
- 未解释的数据丢失、权限或持续 5xx。

---

## 13. 最终交付清单

P2 交付不是一个 PR，而是下列证据集合：

- [ ] current acceptance ledger
- [ ] clean release-intake package map
- [ ] fixed-version Playwright + axe harness
- [ ] isolated staging + isolated DB proof
- [ ] real browser core journey matrix
- [ ] WCAG 2.2 AA automated + manual report
- [ ] production-build hydration report
- [ ] Core Web Vitals/performance report
- [ ] real Week-1 deck publish and playback proof
- [ ] 200-join and 40-room load proof
- [ ] Sentry/uptime/alert delivery proof
- [ ] database backup/PITR restore drill
- [ ] incident tabletop report
- [ ] full lint/test/db/build gate
- [ ] same-SHA staging soak evidence
- [ ] owner-approved production release decision
- [ ] post-deploy smoke and observation window

任何一项缺失时，准确状态应是“P2 部分完成”或具体的 <code>implemented-unverified</code>/<code>verified-staging</code>，不能写成“P2 已上线”。

---

## 14. 本计划的当前验证边界

本计划编写时已执行：

- 当前 Git status、HEAD/origin/main、recent commits 检查；
- <code>npm run release:clean-check</code>：
  - 初次失败来自当时存在的教学 dirty overlay；
  - <code>1b2c1f8</code> 并发提交后重跑，失败项精确收敛为本计划与本 S10 log 两个未跟踪文件；
- 旧 P2.1-P2.5 与近期提交映射；
- performance/a11y、observability、staging、privacy、teaching audit 文档检查；
- 在当前 <code>1b2c1f8</code> 上运行 <code>npm run test -- tests/performance-accessibility-baseline.test.ts tests/observability-readiness.test.ts tests/app-healthz.test.ts tests/critical-user-flow-matrix.test.ts tests/teaching-page.test.tsx</code>：5 files、159 tests 全部通过；jsdom 同时打印 4 次不支持跨 Document navigation 的提示，因此下载/导航仍需真实浏览器 gate；
- 公开只读 live probe：
  - <code>/login</code>：200；
  - <code>/healthz</code>：先 503 database unreachable/migrations unknown，随后三次 200 database/migrations ok。

未执行：

- 未运行全量 lint/test/build；
- 未运行真实 DB suite；
- 未进行登录后的生产写操作；
- 未运行 Lighthouse/axe/manual AT；
- 未创建 staging；
- 未更改 env/Vercel/Sentry/uptime/provider；
- 未提交、推送或部署。

因此，这是一份基于当前证据的**实施计划**，不是 P2 已完成或生产已通过的证明。
