# UAIS 课堂课时包 v1

每个 UTF-8 JSON 文件表示一个课时。网页导入生成草稿，教师检查学生预览、选择班级与任务后再发布。首轮示例是 `data/classroom-lessons/01-natural-numbers.json` 与 `data/classroom-lessons/02-induction.json`：大学《初等数学研究》两课，每课 45 分钟，中文为主，附英文说明及完整双语任务。材料由 Codex 协助编写，供任课教师校订；没有把任何教师列为作者或声称已在真实课堂验证。

## 文件字段与隔离边界

实际校验入口是 `normalizeLessonPackage`（`src/lib/classroom-lessons/domain.ts`）。不要在 JSON 中加入课程 ID、班级 ID、账号、角色、发布状态或外部脚本；课程与权限由当前登录教师和网页目标决定。

| 字段 | 内容与当前限制 |
|---|---|
| `schemaVersion` | 数字 `1`。 |
| `primaryLocale` | `"zh-CN"` 或 `"en-US"`。 |
| `studentContent.title` | 非空字符串，最多 200 字符。 |
| `studentContent.objectives` | 最多 12 条，每条最多 2,000 字符。 |
| `studentContent.body` | 学生正文，非空，最多 50,000 字符。用普通文本换行；不依赖外部 HTML、脚本或自动 LaTeX 渲染。 |
| `studentContent.questions` | 最多 20 个 `{id,prompt}`；`id` 在课时内唯一，1–100 个字母、数字、下划线或连字符；题干最多 4,000 字符。 |
| `studentContent.mediaSlides` | 可省略。最多 12 页，字段见下文。无媒体的文字课时可发布。 |
| `teacherGuide.notes` | 教师讲解、时间安排、量规说明和来源记录；最多 12,000 字符，可为空。 |
| `teacherGuide.answers` | 最多 20 个 `{questionId,answer}`；必须引用本课已有问题 ID，不能重复；每个答案最多 6,000 字符。 |
| `tasks` | 最多 12 个任务模板，结构见下文；空数组表示只导入课时材料。 |

学生正文、题干及媒体页的 `notes` 全部会交付给学生。教师参考答案只放 `teacherGuide`。`studentLessonContent` 使用字段白名单构造学生材料；不要自行把整个教师包发送给学生、放进学生下载或 AI 上下文。课堂包文件本身含答案，教师应保管原文件，不把原始 JSON 发给学生。

文字总量（去掉媒体后序列化计数）最多 120,000 字符。课时请求最多 4,000,000 字节。限制以代码为准，导入预览会报告不合格文件。

## 任务模板

每个任务具有唯一 `id`、`title`、`instructions`、`checkpoint`、`rubric` 和 `aiPolicy`。双语文字格式为 `{"zh-CN":"中文","en-US":"English"}`；示例为两种语言分别填写。校验器接受单一字符串并复用到两种语言，或用主语言补足缺项，**不会自动翻译**。

- `checkpoint` 的 `kind` 是 `"single-choice"` 或 `"short-answer"`。两者都需要双语 `prompt` 和 `explanation`；单选题另需 2–8 个 `{id,label}` 选项以及匹配其中一个选项的 `correctOptionId`。形成性检查解释用于作答后的学习反馈，不应塞入尚未作答的学生正文。
- `rubric` 必须有 3–5 个 ID 唯一的 `{id,label}`；`label` 是双语文字。系统逐项支持未评阅、达到、部分达到、需要修订，不从这些标签自动推导百分制成绩。
- `aiPolicy` 是 `"disabled"` 或 `"teacher-requested-draft"`。两个示例均为 `"disabled"`，教师可完成全部手工反馈。
- 当前模板导入时固定采用 `revisionPolicy:"teacher-requested"`。无需在文件加入该字段。任务的课时键、班级、版本和发布状态由服务端在发布时设置。
- 图片作业能力由提交系统提供；不向模板添加 `attachments` 或公开图片地址。示例任务说明文字/图片任选；每个提交版本最多 3 张 PNG/JPEG，每张不超过 1 MiB。

最小顶层形状如下；具体可用模板以两份完整示例为准：

```json
{
  "schemaVersion": 1,
  "primaryLocale": "zh-CN",
  "studentContent": {
    "title": "课时标题",
    "objectives": ["学习目标"],
    "body": "学生材料正文",
    "questions": [{"id": "q1", "prompt": "思考题"}]
  },
  "teacherGuide": {
    "notes": "教师讲解提示",
    "answers": [{"questionId": "q1", "answer": "教师参考答案"}]
  },
  "tasks": []
}
```

可选媒体页为 `{id,title,notes,image?,audio?}`，每页至少一种媒体。`image` 支持 `image/png`、`image/jpeg`；`audio` 支持通过 PCM WAV 校验的 `audio/wav`。每个文件是 `{mime,base64}`，不带 `data:` 前缀，不填远程 URL；每个解码后文件最多 1 MiB，整课媒体合计 2 MiB。两个数学示例完全使用文字，学生可自画点图，不包含第三方图片或音频。

## 导入、校订和版本

1. 教师登录 `/teaching`，创建或选择自己的课程，在“学生与班级”创建班级。
2. 在“课时与任务”选择两个 JSON 文件，检查每份学生材料预览，然后“确认导入有效课时”。每个文件独立保存为草稿；一份失败不会让未保存文件显示为已发布。
3. 依次打开课时，核对标题、正文、题干和教师备课信息。修改后先“保存草稿”；任务标题、说明、形成性检查和量规使用网页任务编辑器；需要修改原始包时可在本地编辑 JSON，但不要将重新导入误认为更新已有课时。
4. 查看学生预览，勾选所需任务与目标班级，再“确认发布课时与所选任务”。只有服务端事务成功才显示发布版本。
5. 再次修改和发布产生新版本。既有任务与提交保留原版本依据；不要为修正课堂表述删除已有提交。

课时卡片分别显示当前草稿和最近发布版本：保存新草稿后会标明尚未发布；该状态比较保存修订号，不判断两次文字是否语义相同。目标班级和“当前已发布任务数”只对应卡片标明的 Vn，任务按班级分别计数，已归档任务不计入；其他班级可能仍使用较早版本。草稿中的任务模板数量单独显示，不等于已经向学生发布的任务数。

重复点击同一次导入/发布可重用该次幂等键；重新选择同一个文件属于新的导入，会新建课时。若只要修改已有课时，应打开该课时编辑。导入原始 JSON 是教师备课操作，不能替代学生端访问权限校验。

## 数学来源与核验

本课的定义、证明和活动措辞为原创编排。公开大学教材用于核对标准数学原则，未复制原书图片、人物故事或完整习题：

- University of Nottingham. (n.d.). *Library Arith: Peano arithmetic*. [Natural numbers section](https://people.cs.nott.ac.uk/psztxa/g52ifr/html/Arith.html)。仅核对零、后继、单射和归纳原则；网页后部存在排版错式，本课未采用。
- Lehman, E., Leighton, F. T., & Meyer, A. R. (2015). *Mathematics for computer science* (§§4.5, 5.1). [MIT OpenCourseWare textbook](https://ocw.mit.edu/courses/6-042j-mathematics-for-computer-science-spring-2015/mit6_042js15_textbook.pdf)。核对有限基数、一一对应及归纳起点与步骤要求。

访问核对日期：2026-10-26。公开全文已足够，不需要使用机构账号或 EdUHK Library 登录。测试 `tests/classroom-lesson-packages.test.ts` 使用真实导入校验器，核对双语字段、教师答案不进入学生材料、计数与循环反例、`f(40)=41²`、两项归纳步骤的精确多项式系数恒等式及倒向归纳的逻辑反例。有限样本计算仅是算术回归检查，不代替材料中完整的归纳证明；这些检查也不表示教学效果已获验证。
