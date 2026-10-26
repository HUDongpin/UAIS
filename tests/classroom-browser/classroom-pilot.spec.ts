import { test, expect, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { resolve } from "node:path";
import sharp from "sharp";
import {
  fixture, privateContext, checked, api, authenticatedFetch, bindLocalRequest, allCompleted, webLogin, activateHttp, key, learningPath, unitPath, percentile, writeSummary, evidenceDir,
  type InitialCredential, type Timing, type Lesson, type LessonView, type Unit, type Receipt,
} from "./pilot-helpers";

type Group = { groupId: string; members: { studentId: string }[] };
type Student = { credential: InitialCredential; request: APIRequestContext; page?: Page; context?: BrowserContext };
type Saved = { account: string; activityId: string; lessonKey: string; submissionId: string; versionId: string; imageId: string };

// One test owns all ephemeral sessions. Nothing writes storageState/cookies or
// credentials to disk; all content creation uses actual UI and authenticated API.
test("classroom pilot from an empty course with thirty students", async ({ browser, playwright }) => {
  const local = await fixture(), f = local.value, sql = local.sql;
  test.setTimeout((15 + f.soakMinutes) * 60_000);
  const run = Date.now().toString(36), title = `初等数学研究 · 自动验收 ${run}`, className = `课堂小班 ${run}`;
  const timings: Timing[] = [], uploads: Timing[] = [], contexts: BrowserContext[] = [], requests: APIRequestContext[] = [], saved: Saved[] = [];
  const completedPhases: string[] = [];
  const runtimeIssues: Array<{ kind: "pageerror" | "hydration"; phase: unknown }> = [];
  const summary: Record<string, unknown> = { completedPhases, run, startedAt: new Date().toISOString(), status: "running", phase: "initializing", classroomSize: 30, plannedLessons: 2, extendedSoak: { requestedMinutes: f.soakMinutes, completedMinutes: 0, verified: false }, credentialData: "omitted", traces: "disabled", target: "isolated-loopback-only", transport: "native Chromium cookies; API client forwards the same signed cookies in memory to bound loopback HTTP only; TLS deployment not tested" };
  async function phase<T>(name: string, action: () => Promise<T>) {
    summary.phase = name; await writeSummary(summary);
    const result = await test.step(`Classroom: ${name}`, action);
    summary.browserRuntime = { pageErrors: runtimeIssues.filter(i=>i.kind==="pageerror").length, hydrationErrors: runtimeIssues.filter(i=>i.kind==="hydration").length };
    if (runtimeIssues.length) throw new Error("browser-runtime-error");
    completedPhases.push(name); await writeSummary(summary); return result;
  }
  let teacher!: Page, teacherContext!: BrowserContext;
  let courseId = "", classId = "", invite = "", lessons: Lesson[] = [], credentials: InitialCredential[] = [], students: Student[] = [], groups: Group[] = [];
  const png = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="140"><rect width="480" height="140" fill="white"/><text x="20" y="65" font-size="32" fill="black">S(6) = 7; k^2 + 2k + 1</text></svg>')).png().toBuffer();
  try {
    await phase("teacher creates course and class through the web", async () => {
      teacherContext = await privateContext(browser, f.baseUrl, kind => runtimeIssues.push({ kind, phase: summary.phase })); contexts.push(teacherContext); teacher = await teacherContext.newPage();
      const teacherReady = teacher.waitForResponse(r => new URL(r.url()).pathname === "/api/teaching/courses" && r.request().method() === "GET");
      await webLogin(teacher, f.teacher.account, f.teacher.password, "/teaching");
      expect((await teacherReady).status()).toBe(200);
      await teacher.getByRole("button", { name: "创建课堂课程", exact: true }).click();
      const dialog = teacher.getByRole("dialog");
      await dialog.locator("#new-course-name").fill(title);
      await dialog.locator("#new-course-instructor").fill("课堂试用教师");
      await dialog.locator("#new-course-unit").fill("UAIS 隔离验收");
      await dialog.locator("#new-course-department").fill("数学教育");
      const courseResponse = teacher.waitForResponse(r => new URL(r.url()).pathname === "/api/teaching/courses" && r.request().method() === "POST");
      await dialog.getByRole("button", { name: "完成", exact: true }).click();
      const created = await checked<{ course: { courseId: string } }>(await courseResponse, "create-course"); courseId = created.course.courseId;
      await expect(dialog).toHaveCount(0);
      await teacher.getByRole("combobox", { name: /^课堂课程/ }).selectOption(courseId);
      await teacher.getByRole("button", { name: "学生与班级", exact: true }).click();
      await teacher.getByRole("button", { name: "创建班级", exact: true }).click();
      await teacher.getByLabel("班级名称", { exact: true }).fill(className);
      const classResponse = teacher.waitForResponse(r => new URL(r.url()).pathname === `/api/teaching/courses/${courseId}/classes` && r.request().method() === "POST");
      await teacher.getByRole("dialog").getByRole("button", { name: "完成", exact: true }).click();
      const createdClass = await checked<{ classItem: { classId: string; invitationCode: string } }>(await classResponse, "create-class");
      classId = createdClass.classItem.classId; invite = createdClass.classItem.invitationCode;
      expect(Boolean(courseId && classId && invite)).toBe(true);
      const empty = await api<{ lessons: Lesson[] }>(teacherContext.request, "GET", `/api/teaching/courses/${courseId}/lessons`); expect(empty.lessons).toHaveLength(0);
    });
    await phase("teacher imports, edits, previews and publishes two actual lesson packages", async () => {
      await teacher.getByRole("button", { name: "课时与任务", exact: true }).click();
      await teacher.getByLabel("选择课时 JSON 文件", { exact: true }).setInputFiles([resolve("data/classroom-lessons/01-natural-numbers.json"), resolve("data/classroom-lessons/02-induction.json")]);
      await expect(teacher.getByText("导入预览（尚未保存）", { exact: true })).toBeVisible();
      const firstImport = teacher.waitForResponse(r => new URL(r.url()).pathname === `/api/teaching/courses/${courseId}/lessons` && r.request().method() === "POST");
      await teacher.getByRole("button", { name: "确认导入有效课时", exact: true }).click();
      await checked(await firstImport,"import-first-lesson");
      await expect(teacher.getByRole("button", { name: "编辑课时", exact: true })).toHaveCount(2);
      lessons = (await api<{ lessons: Lesson[] }>(teacherContext.request, "GET", `/api/teaching/courses/${courseId}/lessons`)).lessons;
      expect(lessons).toHaveLength(2);
      for (const lesson of lessons) {
        await teacher.locator("article").filter({ has: teacher.getByRole("heading", { name: lesson.title, exact: true }) }).getByRole("button", { name: "编辑课时", exact: true }).click();
        const text = teacher.getByRole("textbox", { name: /^学生讲解正文/ });
        await text.fill((await text.inputValue()) + `\n课堂验收批次 ${run}；教师已校订。`);
        await teacher.getByText("教师备课信息（学生不可见）", { exact: true }).click();
        await teacher.getByRole("textbox", { name: /^教师备注/ }).fill(`PRIVATE-TEACHER-ONLY-${run}\n` + "教师参考答案仅在教师端保留。");
        const saveResponse = teacher.waitForResponse(r => new URL(r.url()).pathname === `/api/teaching/courses/${courseId}/lessons/${lesson.lessonKey}` && r.request().method() === "PATCH");
        await teacher.getByRole("button", { name: "保存草稿", exact: true }).click(); await checked(await saveResponse, "save-lesson");
        await expect(teacher.getByRole("button", { name: "保存草稿", exact: true })).toBeDisabled();
        await teacher.getByRole("button", { name: "预览学生视图", exact: true }).click();
        expect(await teacher.getByText(`PRIVATE-TEACHER-ONLY-${run}`, { exact: false }).count()).toBe(0);
        const published = teacher.waitForResponse(r => new URL(r.url()).pathname.endsWith(`/${lesson.lessonKey}/publish`) && r.request().method() === "POST");
        await teacher.getByRole("button", { name: "确认发布课时与所选任务", exact: true }).click();
        const result = await checked<{ receipt: { version: number; activityIds: string[] } }>(await published, "publish-lesson");
        expect(result.receipt.version).toBe(1); expect(result.receipt.activityIds).toHaveLength(1);
        await expect(teacher.getByText("课时和所选任务已发布。学生刷新课程后即可进入。", { exact: true })).toBeVisible();
      }
      const overview = await teacherContext.newPage();
      await overview.goto(`/teaching/courses/${courseId}/lessons`);
      await expect(overview.getByRole("button",{name:"编辑课时",exact:true})).toHaveCount(2);
      await expect(overview.getByText(`V1 发布到：${className}`,{exact:true})).toHaveCount(2);
      await expect(overview.getByText("V1 当前已发布任务：1 项（按班级计）",{exact:true})).toHaveCount(2);
      await expect(overview.getByText("草稿任务模板：1 项",{exact:true})).toHaveCount(2);
      await overview.screenshot({ path: resolve(evidenceDir, "teacher-two-published-lessons.png"), fullPage: false });
      await overview.close();
    });
    await phase("teacher previews and imports thirty student accounts on the web", async () => {
      await teacher.getByRole("button", { name: "学生与班级", exact: true }).click();
      const csv = "account,displayName\n" + Array.from({ length: 30 }, (_, i) => `pilot-${run}-${String(i + 1).padStart(2,"0")},测试学生 ${i + 1}`).join("\n");
      await teacher.getByLabel("选择名单 CSV", { exact: true }).setInputFiles({ name: "synthetic-roster.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
      await teacher.getByRole("button", { name: "预览名单", exact: true }).click();
      await expect(teacher.getByRole("button", { name: "确认创建学生账号", exact: true })).toBeEnabled();
      const imported = teacher.waitForResponse(r => new URL(r.url()).pathname.endsWith(`/${classId}/roster`) && r.request().method() === "POST" && r.request().postDataJSON()?.action === "import");
      await teacher.getByRole("button", { name: "确认创建学生账号", exact: true }).click();
      const result = await checked<{ credentials: InitialCredential[]; createdCount: number }>(await imported, "import-roster");
      expect(result.createdCount).toBe(30); credentials = result.credentials.sort((a,b) => a.account.localeCompare(b.account));
      await teacher.getByRole("button", { name: "清除本次凭据", exact: true }).click();
      expect(await teacher.getByRole("button", { name: "下载初始凭据", exact: true }).count()).toBe(0);
    });
    await phase("two browser students set passwords and thirty students request class admission", async () => {
      students = await allCompleted(credentials.map(async (credential, index): Promise<Student> => {
        if (index === 0 || index === 3) {
          const context = await privateContext(browser, f.baseUrl, kind => runtimeIssues.push({ kind, phase: summary.phase })); contexts.push(context); const page = await context.newPage();
          await webLogin(page, credential.account, credential.initialPassword, `/courses?invite=${invite}`, true);
          await expect(page.getByRole("heading", { name: "设置你的学习账号密码" })).toBeVisible();
          await expect(page.getByLabel("新密码", { exact: true })).toBeVisible();
          const blocked = await authenticatedFetch(context.request,`/api/learning/courses/${courseId}/lessons?classId=${classId}`); expect(blocked.status()).toBe(401);
          const setup = await api<{ redirectTarget: string }>(context.request, "POST", "/api/auth/first-password", { password: f.studentPassword });
          await page.goto(setup.redirectTarget);
          await expect(page.getByRole("button", { name: "申请加入班级", exact: true })).toBeEnabled();
          return { credential, request: context.request, page, context };
        }
        const request = bindLocalRequest(await playwright.request.newContext({ baseURL: f.baseUrl }), f.baseUrl); requests.push(request);
        await activateHttp(request, credential, f.studentPassword);
        return { credential, request };
      }));
      // All thirty accounts are ready before any admission request starts. Two
      // requests come from actual UI clicks; the other 28 use authenticated HTTP.
      await allCompleted(students.map(async student => {
        if (!student.page) { await api(student.request,"POST",`/api/teaching/invite-codes/${invite}/join`,{},timings,"join"); return; }
        const page = student.page, started = performance.now();
        const joined = page.waitForResponse(r => new URL(r.url()).pathname === `/api/teaching/invite-codes/${invite}/join` && r.request().method() === "POST");
        await page.getByRole("button", { name: "申请加入班级", exact: true }).click();
        const response = await joined; timings.push({operation:"join",durationMs:performance.now()-started,status:response.status()});
        expect(response.status()).toBe(201);
      }));
      const rosterReadback = teacher.waitForResponse(r => new URL(r.url()).pathname === "/api/teaching/courses" && r.request().method() === "GET");
      await teacher.reload(); await checked(await rosterReadback,"roster-readback");
      await teacher.getByRole("combobox", { name: /^课堂课程/ }).selectOption(courseId);
      await expect(teacher.getByRole("combobox", { name: /^课堂课程/ })).toHaveValue(courseId);
      await teacher.getByRole("button", { name: "学生与班级", exact: true }).click();
      await teacher.getByRole("button", { name: "查看与审批名单", exact: true }).click();
      await teacher.getByRole("button", { name: `批准${className}的全部 30 条待审批申请`, exact: true }).click();
      const approved = teacher.waitForResponse(r => new URL(r.url()).pathname === `/api/teaching/classes/${classId}/memberships/approve` && r.request().method() === "POST");
      await teacher.getByRole("button", { name: "确认批准", exact: true }).click();
      const result = await checked<{ approvedCount: number }>(await approved, "approve-roster"); expect(result.approvedCount).toBe(30);
      const groupA = (await api<{ group: Group }>(teacherContext.request,"POST",`/api/teaching/courses/${courseId}/groups`,{classId,groupName:"浏览器检查甲组",members:students.slice(0,3).map(s=>s.credential.account)})).group;
      const groupB = (await api<{ group: Group }>(teacherContext.request,"POST",`/api/teaching/courses/${courseId}/groups`,{classId,groupName:"浏览器检查乙组",members:students.slice(3,6).map(s=>s.credential.account)})).group;
      groups = [groupA,groupB,...(await api<{ groups: Group[] }>(teacherContext.request, "POST", `/api/teaching/courses/${courseId}/groups/auto-split`, { classId, groupSize: 3 })).groups];
      expect(groups).toHaveLength(10);
    });
    await phase("two browser students select lessons and submit the first task with text and images", async () => {
      for (const student of students.filter(value => value.page)) {
        for (const lesson of lessons.slice(0, 1)) {
          const view = await api<LessonView>(student.request, "GET", `/api/learning/courses/${courseId}/lessons/${lesson.lessonKey}?classId=${classId}`);
          expect(JSON.stringify(view).includes(`PRIVATE-TEACHER-ONLY-${run}`)).toBe(false);
          const activityId = view.lesson.tasks[0].id;
          const before = await api<Unit>(student.request, "GET", unitPath(courseId,lesson.lessonKey,activityId));
          expect(before.activity.checkpoint).not.toHaveProperty("correctOptionId"); expect(before.activity.checkpoint).not.toHaveProperty("explanation");
          const page = student.page!;
          await page.goto(learningPath(courseId,classId,lesson.lessonKey,activityId));
          await expect(page.getByRole("navigation", { name: "课时目录" }).getByRole("link")).toHaveCount(2);
          await page.getByRole("radio").first().check();
          await page.getByRole("button", { name: "提交检查", exact: true }).click();
          const text = page.getByLabel("学习产物正文", { exact: true }); await expect(text).toBeEnabled();
          await text.fill(`我的配对与证明：S(6)=7。任意 k≥0 时，新增 2k+1 个点。批次 ${run}。`);
          await expect(page.getByText("已由服务端保存", { exact: true })).toBeVisible();
          const uploaded = page.waitForResponse(r => new URL(r.url()).pathname === `/api/learning/activities/${activityId}/submission/images` && r.request().method() === "POST");
          await page.getByLabel("上传作业图片", { exact: true }).setInputFiles({ name: "worked-proof.png", mimeType: "image/png", buffer: png });
          expect((await uploaded).status()).toBe(200);
          const uploadReadback = await api<Unit>(student.request,"GET",unitPath(courseId,lesson.lessonKey,activityId));
          const image = { attachment: { id: uploadReadback.submission!.currentVersion.attachments[0].id } };
          await expect(page.getByRole("img", { name: "作业图片 1", exact: true })).toBeVisible();
          await expect(page.getByRole("button", { name: "封存并提交", exact: true })).toBeEnabled();
          const sealed = page.waitForResponse(r => new URL(r.url()).pathname === `/api/learning/activities/${activityId}/submission/submit` && r.request().method() === "POST");
          await page.getByRole("button", { name: "封存并提交", exact: true }).click(); expect((await sealed).status()).toBe(200);
          const unit = await api<Unit>(student.request,"GET",unitPath(courseId,lesson.lessonKey,activityId));
          expect(unit.submission?.state).toBe("submitted"); expect(unit.submission?.currentVersion.attachments).toHaveLength(1);
          saved.push({ account: student.credential.account, activityId, lessonKey: lesson.lessonKey, submissionId: unit.submission!.id, versionId: unit.submission!.currentVersion.id, imageId: image.attachment.id });
        }
      }
    });
    await phase("all thirty students complete both lessons including one thirty-way HTTP submission wave", async () => {
      for (const lesson of lessons) {
        await allCompleted(students.filter(value => lesson.position > 1 || !value.page).map(async student => {
          const view = await api<LessonView>(student.request,"GET",`/api/learning/courses/${courseId}/lessons/${lesson.lessonKey}?classId=${classId}`);
          expect(JSON.stringify(view).includes(`PRIVATE-TEACHER-ONLY-${run}`)).toBe(false);
          const activityId = view.lesson.tasks[0].id;
          await api(student.request,"POST",`/api/learning/activities/${activityId}/formative-attempt`,{ response: { kind:"single-choice", optionId: lesson.position === 1 ? "b" : "even" } },timings,"checkpoint",key());
          const draft = await api<Receipt>(student.request,"PUT",`/api/learning/activities/${activityId}/submission`,{ contentText:"从 n=0 起，假设 O(k)=k²，再增加 2k+1 得到 (k+1)²。",expectedSubmissionVersionId:null,expectedDraftRevision:0 },timings,"save");
          const clientAttachmentId = key().slice(6); const started = performance.now();
          const response = await authenticatedFetch(student.request,`/api/learning/activities/${activityId}/submission/images`, { method:"POST", multipart: { image: { name:"proof.png",mimeType:"image/png",buffer:png }, expectedSubmissionVersionId:draft.submissionVersionId,expectedDraftRevision:String(draft.revision),clientAttachmentId },timeout:60_000 });
          uploads.push({operation:"upload",durationMs:performance.now()-started,status:response.status()});
          const uploaded = await checked<{ attachment:{id:string};revision:number }>(response,"load-upload");
          const payload={expectedSubmissionVersionId:draft.submissionVersionId,expectedDraftRevision:uploaded.revision},idempotencyKey=key();
          const sealed=await api<Receipt>(student.request,"POST",`/api/learning/activities/${activityId}/submission/submit`,payload,timings,"seal",idempotencyKey);
          const replay=await api<Receipt>(student.request,"POST",`/api/learning/activities/${activityId}/submission/submit`,payload,undefined,"seal-replay",idempotencyKey);expect(replay).toEqual(sealed);
          saved.push({account:student.credential.account,activityId,lessonKey:lesson.lessonKey,submissionId:draft.resourceId,versionId:draft.submissionVersionId,imageId:uploaded.attachment.id});
        }));
      }
      expect(saved).toHaveLength(60); expect(new Set(saved.map(item=>item.submissionId)).size).toBe(60);
      const rows=await sql`SELECT s.id,s.state,v.id AS version_id,v.status,(SELECT count(*)::integer FROM uais_submission_attachments i WHERE i.submission_version_id=v.id) AS images FROM uais_submissions s JOIN uais_submission_versions v ON v.submission_id=s.id JOIN uais_assessments a ON a.id=s.assessment_id JOIN uais_lessons l ON l.id=a.lesson_id JOIN uais_courses c ON c.id=l.course_id WHERE c.slug=${courseId}`;
      expect(rows).toHaveLength(60);
      for(const receipt of saved)expect(rows.find(row=>row.id===receipt.submissionId)).toMatchObject({state:"submitted",status:"sealed",version_id:receipt.versionId,images:1});
      summary.submissions={expected:60,confirmed:rows.length,duplicates:0,missing:0,images:60};
    });
    await phase("teacher reviews actual images and releases feedback visible after relogin",async()=>{
      for(const student of students.filter(value=>value.page)){
        const item=saved.find(item=>item.account===student.credential.account&&item.lessonKey===lessons[0].lessonKey)!;
        await teacher.goto(`/teaching/submissions/${item.submissionId}`);
        await expect(teacher.getByRole("img",{name:"V1 作业图片 1",exact:true})).toBeVisible();
        await teacher.getByLabel("教师确认反馈",{exact:true}).fill(`课堂反馈 ${run}：对应关系清楚，请继续核验归纳起点与新增项。`);
        for(const select of await teacher.locator("main select").all())await select.selectOption("met");
        const released=teacher.waitForResponse(r=>new URL(r.url()).pathname===`/api/teaching/submissions/${item.submissionId}/decision`&&r.request().method()==="POST");
        await teacher.getByRole("button",{name:"发布反馈并接受",exact:true}).click();expect((await released).status()).toBe(200);
        const from=learningPath(courseId,classId,item.lessonKey,item.activityId);
        await api(student.request,"DELETE","/api/auth/app-session");
        await webLogin(student.page!,student.credential.account,f.studentPassword,from);
        await expect(student.page!.getByText(`课堂反馈 ${run}：对应关系清楚，请继续核验归纳起点与新增项。`,{exact:true})).toBeVisible();
        await student.page!.reload();await expect(student.page!.getByText("教师已接受",{exact:true}).first()).toBeVisible();
        await student.page!.getByRole("heading",{name:"教师已发布反馈",exact:true}).scrollIntoViewIfNeeded();
        await student.page!.screenshot({path:resolve(evidenceDir,`student-feedback-${student===students[0]?"a":"b"}.png`),fullPage:false});
      }
      summary.feedbackReadback={students:2,refresh:true,relogin:true};
      const reviewedActivity=saved.find(item=>item.account===students[0].credential.account&&item.lessonKey===lessons[0].lessonKey)!.activityId;
      await teacher.goto(`/teaching/activities/${reviewedActivity}/submissions`);
      const overview=teacher.getByRole("region",{name:"全班作业概况",exact:true});
      await expect(overview.getByLabel("未交人数",{exact:true}).locator("dd")).toHaveText("0");
      await expect(overview.getByLabel("已交人数",{exact:true}).locator("dd")).toHaveText("30");
      await expect(overview.getByLabel("待修订人数",{exact:true}).locator("dd")).toHaveText("0");
      await expect(overview.getByLabel("已反馈人数",{exact:true}).locator("dd")).toHaveText("2");
      await expect(teacher.locator("tbody tr")).toHaveCount(25);
      await teacher.screenshot({path:resolve(evidenceDir,"teacher-submission-overview.png"),fullPage:false});
      summary.teacherQueueReadback={classSize:30,visiblePageSize:25,notSubmitted:0,submitted:30,revisionRequested:0,feedbackReleased:2};
    });
    await phase("version two preserves old task evidence and image access boundaries",async()=>{
      await teacher.goto(`/teaching/courses/${courseId}/lessons`);
      const first=lessons[0];await teacher.locator("article").filter({has:teacher.getByRole("heading",{name:first.title,exact:true})}).getByRole("button",{name:"编辑课时",exact:true}).click();
      await teacher.getByRole("textbox",{name:/^学生讲解正文/}).fill(`V2-MARKER-${run}\n教师更正后的内容。`);
      await teacher.getByRole("button",{name:"保存草稿",exact:true}).click();await expect(teacher.getByRole("button",{name:"保存草稿",exact:true})).toBeDisabled();
      await expect(teacher.locator("article").filter({has:teacher.getByRole("heading",{name:first.title,exact:true})}).getByText("草稿已更新，尚未发布",{exact:true})).toBeVisible();
      const published=teacher.waitForResponse(r=>new URL(r.url()).pathname.endsWith(`/${first.lessonKey}/publish`)&&r.request().method()==="POST");
      await teacher.getByRole("button",{name:"确认发布课时与所选任务",exact:true}).click();expect((await checked<{receipt:{version:number}}>(await published,"publish-v2")).receipt.version).toBe(2);
      const item=saved.find(row=>row.account===students[0].credential.account&&row.lessonKey===first.lessonKey)!;
      const old=await api<LessonView>(students[0].request,"GET",`/api/learning/courses/${courseId}/lessons/${first.lessonKey}?classId=${classId}&activityId=${item.activityId}`);
      expect(old.lesson.version).toBe(1);expect(old.lesson.content.body).not.toContain(`V2-MARKER-${run}`);
      const latest=await api<LessonView>(students[0].request,"GET",`/api/learning/courses/${courseId}/lessons/${first.lessonKey}?classId=${classId}`);expect(latest.lesson.version).toBe(2);
      const other=await authenticatedFetch(students[3].request,`/api/learning/submission-images/${item.imageId}`);expect(other.status()).toBe(404);
      const anonymous=bindLocalRequest(await playwright.request.newContext({baseURL:f.baseUrl}),f.baseUrl);requests.push(anonymous);expect((await authenticatedFetch(anonymous,`/api/learning/submission-images/${item.imageId}`)).status()).toBe(401);
      summary.authorization={otherStudentImageDenied:true,anonymousImageDenied:true,teacherGuideExcluded:true,oldTaskPinnedToVersion:1,newLessonVersion:2};
      summary.teacherLessonReadback={targetClassNames:true,publishedTaskCounts:true,unpublishedDraftState:true};
    });
    await phase("different groups exchange real human messages without AI",async()=>{
      const groupFor=(account:string)=>groups.find(group=>group.members.some(member=>member.studentId===account))!;
      const a=groupFor(students[0].credential.account),b=groupFor(students[3].credential.account);expect(a.groupId).not.toBe(b.groupId);
      await allCompleted(students.map(async(student,index)=>{
        const group=groupFor(student.credential.account);const message=`课堂真人讨论 ${run} ${index+1}：先明确对象，再检查推理。`;
        await api(student.request,"POST","/api/learning/chatroom",{locale:"zh-CN",courseId,classId,groupId:group.groupId,messages:[{id:key(),role:"student",content:message}]},timings,"chat-send");
        const history=await api<{messages:{content?:string;text?:unknown}[]}>(student.request,"GET",`/api/learning/chatroom/history?${new URLSearchParams({courseId,classId,groupId:group.groupId})}`,undefined,timings,"chat-read");expect(JSON.stringify(history)).toContain(message);
      }));
      const denied=await authenticatedFetch(students[0].request,`/api/learning/chatroom/history?${new URLSearchParams({courseId,classId,groupId:b.groupId})}`);expect(denied.status()).toBe(403);
      summary.discussion={groups:10,messages:30,crossGroupReadDenied:true,aiRequested:false};
    });
    await phase("pending image survives offline refresh and reconciles once",async()=>{
      const student=students[0],page=student.page!,first=lessons[0];
      const latest=await api<LessonView>(student.request,"GET",`/api/learning/courses/${courseId}/lessons/${first.lessonKey}?classId=${classId}`),activityId=latest.lesson.tasks[0].id;
      await page.goto(learningPath(courseId,classId,first.lessonKey,activityId));await page.getByRole("radio").first().check();await page.getByRole("button",{name:"提交检查",exact:true}).click();
      await page.getByLabel("学习产物正文",{exact:true}).fill("离线图片恢复检查：这段文字先保存。");await expect(page.getByText("已由服务端保存",{exact:true})).toBeVisible();
      await student.context!.setOffline(true);
      await page.getByLabel("上传作业图片",{exact:true}).setInputFiles({name:"offline-proof.png",mimeType:"image/png",buffer:png});
      await expect(page.getByRole("button",{name:"重试图片上传",exact:true})).toBeEnabled();await expect(page.getByRole("button",{name:"封存并提交",exact:true})).toBeDisabled();
      await student.context!.setOffline(false);await page.reload();await expect(page.getByRole("button",{name:"重试图片上传",exact:true})).toBeEnabled();
      await page.getByRole("button",{name:"重试图片上传",exact:true}).click();await expect(page.getByRole("img",{name:"作业图片 1",exact:true})).toBeVisible();
      const unit=await api<Unit>(student.request,"GET",unitPath(courseId,first.lessonKey,activityId));expect(unit.submission?.currentVersion.attachments).toHaveLength(1);
      summary.recovery={offlinePendingImagePersisted:true,reconciledImageCount:1,pendingBlockedSeal:true};
    });
    if(f.soakMinutes>0)await phase("ninety minute continuous classroom read soak",async()=>{
      const started=Date.now(),deadline=started+f.soakMinutes*60_000;let rounds=0,reads=0;
      const progress=(verified:boolean)=>({requestedMinutes:f.soakMinutes,completedMinutes:Math.round((Date.now()-started)/6000)/10,rounds,reads,actors:students.length,verified});
      expect(students).toHaveLength(30);
      summary.extendedSoak=progress(false);await writeSummary(summary);
      // A separate timer keeps progress visible even while one bounded request
      // waits. Serialize report writes and never log actor identifiers or cookies.
      let pendingReport=Promise.resolve();let reportFailure:unknown;
      const heartbeat=setInterval(()=>{
        summary.extendedSoak=progress(false);
        pendingReport=pendingReport.then(()=>writeSummary(summary)).catch(error=>{reportFailure=error;});
      },30_000);
      try{
        while(Date.now()<deadline){
          if(reportFailure)throw new Error("soak-progress-write-failed");
          const round=Date.now();
          await allCompleted(students.map(async student=>{const group=groups.find(g=>g.members.some(m=>m.studentId===student.credential.account))!;await api(student.request,"GET",`/api/learning/chatroom/history?${new URLSearchParams({courseId,classId,groupId:group.groupId})}`,undefined,timings,"soak-chat-read");reads++;}));
          rounds++;await new Promise(resolve=>setTimeout(resolve,Math.max(0,2500-(Date.now()-round))));
        }
      }finally{
        clearInterval(heartbeat);await pendingReport;
        summary.extendedSoak=progress(false);await writeSummary(summary);
      }
      if(reportFailure)throw new Error("soak-progress-write-failed");
      expect(Date.now()).toBeGreaterThanOrEqual(deadline);expect(runtimeIssues).toHaveLength(0);
      summary.extendedSoak=progress(true);await writeSummary(summary);
    });
    const ordinary=timings.filter(item=>["save","seal","chat-read","chat-send"].includes(item.operation));
    const byOperation=Object.fromEntries([...new Set(timings.map(t=>t.operation))].map(operation=>{ const group=timings.filter(t=>t.operation===operation);return [operation,{requests:group.length,p50Ms:percentile(group.map(t=>t.durationMs),.5),p95Ms:percentile(group.map(t=>t.durationMs),.95),failures:group.filter(t=>t.status<200||t.status>=300).length}];}));
    summary.performance={byOperation,ordinaryRequests:ordinary.length,ordinaryP95Ms:percentile(ordinary.map(v=>v.durationMs),.95),uploadRequests:uploads.length,uploadP95Ms:percentile(uploads.map(v=>v.durationMs),.95),scope:"actual authenticated HTTP against isolated loopback server; production classroom latency not measured"};
    expect(ordinary.every(value=>value.status>=200&&value.status<300)).toBe(true);
    expect(percentile(ordinary.map(value=>value.durationMs),.95)!).toBeLessThanOrEqual(2000);
    summary.browserRuntime = { pageErrors: runtimeIssues.filter(i=>i.kind==="pageerror").length, hydrationErrors: runtimeIssues.filter(i=>i.kind==="hydration").length };
    expect(runtimeIssues).toHaveLength(0);
    summary.status="passed";summary.completedAt=new Date().toISOString();await writeSummary(summary);
  }catch(error){
    summary.browserRuntime = { pageErrors: runtimeIssues.filter(i=>i.kind==="pageerror").length, hydrationErrors: runtimeIssues.filter(i=>i.kind==="hydration").length, affectedPhases: [...new Set(runtimeIssues.map(i=>i.phase))] };
    summary.status="failed";summary.completedAt=new Date().toISOString();
    const message=error instanceof Error?error.message:"";
    summary.failureCode=/^[a-z0-9:-]{1,160}$/.test(message)?message:"assertion-or-browser-step-failed";
    summary.networkFailureClass=message.match(/ECONNRESET|ECONNREFUSED|ETIMEDOUT|socket hang up|Timeout|disposed|closed|Request timed out/)?.[0]??null;
    summary.failureAction=message.match(/\b(?:page|locator)\.[a-zA-Z]+/)?.[0]??"assertion";
    summary.failureLocation=(error instanceof Error?error.stack:"")?.match(/(?:classroom-pilot\.spec|pilot-helpers)\.ts:\d+:\d+/)?.[0]??"unknown";
    summary.lastTeacherPath=teacher?new URL(teacher.url()).pathname:"not-opened";
    summary.browserStudentPaths=students.filter(s=>s.page).map(s=>new URL(s.page!.url()).pathname);
    if (summary.phase === "two browser students set passwords and thirty students request class admission") { summary.visibleApprovalButtons = await teacher.getByRole("button", { name: /^批准/ }).allTextContents().catch(()=>[]); await teacher.screenshot({path:resolve(evidenceDir,"teacher-approval-diagnostic.png"),fullPage:true}).catch(()=>{}); }
    for(const [index,student] of students.filter(s=>s.page).entries()) if(new URL(student.page!.url()).pathname==="/learning") await student.page!.screenshot({path:resolve(evidenceDir,`student-learning-diagnostic-${index}.png`),fullPage:true}).catch(()=>{});
    if(summary.phase==="teacher creates course and class through the web") { summary.createdCourseId=courseId;summary.courseOptions=await teacher.locator("select option").allTextContents().catch(()=>[]); }
    if ((summary.phase === "teacher creates course and class through the web" || summary.phase === "teacher imports, edits, previews and publishes two actual lesson packages") && summary.lastTeacherPath === "/teaching") await teacher.screenshot({path:resolve(evidenceDir,"teacher-setup-diagnostic.png"),fullPage:true}).catch(()=>{});
    await writeSummary(summary);throw error;
  }finally{
    for(const context of contexts)await context.close().catch(()=>{});
    for(const request of requests)await request.dispose().catch(()=>{});
    await sql.end();
  }
});
