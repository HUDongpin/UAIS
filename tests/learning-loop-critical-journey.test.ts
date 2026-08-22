import { describe, expect, it } from "vitest";
import {
  createActivitySubmissionsGetHandler,
  createAiFeedbackDraftPostHandler,
  createFormativeAttemptPostHandler,
  createLearningDashboardGetHandler,
  createLearningUnitGetHandler,
  createSubmissionDraftPutHandler,
  createSubmissionSubmitPostHandler,
  createTeacherSubmissionDecisionPostHandler,
  createTeachingActivitiesPostHandler,
  createTeachingActivityPatchHandler,
} from "./helpers/learning-loop-route-factories";
import {
  assertSubmissionTransition,
  type LearningSubmissionState,
} from "@/lib/learning-loop/domain";
import { recommendNextLearningAction } from "@/lib/learning-loop/recommendation";

const courseId = "course-1";
const classId = "class-1";
const lessonKey = "lesson-1";
const activityId = "activity-1";
const submissionId = "submission-1";

const teacherAccess = {
  status: "authorized" as const,
  reasonCode: "teacher-dual-session-course-owner" as const,
  teacherAccount: "teacher-1",
  course: { externalId: courseId, title: "Course one" },
  classes: [{ externalId: classId, name: "Class one" }],
  lesson: {
    key: lessonKey,
    position: 1,
    title: { "zh-CN": "第一讲", "en-US": "Lesson one" },
    manifestRef: "published-manifest-1",
  },
};

const studentAccess = {
  status: "authorized" as const,
  reasonCode: "student-course-membership-approved" as const,
  studentAccount: "student-1",
  courseId,
  classId,
};

const activityDraft = {
  lessonKey,
  targetClassId: classId,
  title: { "zh-CN": "证据解释任务", "en-US": "Evidence explanation" },
  instructions: {
    "zh-CN": "用证据解释概念之间的关系。",
    "en-US": "Use evidence to explain the relationship between concepts.",
  },
  checkpoint: {
    kind: "short-answer",
    prompt: { "zh-CN": "先写一个关键证据。", "en-US": "State one key piece of evidence." },
    explanation: { "zh-CN": "证据应与课件相关。", "en-US": "Evidence should relate to the lesson." },
  },
  rubric: [
    { id: "claim", label: { "zh-CN": "主张", "en-US": "Claim" } },
    { id: "evidence", label: { "zh-CN": "证据", "en-US": "Evidence" } },
    { id: "reasoning", label: { "zh-CN": "推理", "en-US": "Reasoning" } },
  ],
  aiPolicy: "teacher-requested-draft",
  revisionPolicy: "teacher-requested",
};

type JourneyVersion = {
  id: string;
  versionNo: number;
  status: "draft" | "sealed";
  contentText: string;
  draftRevision: number;
};

type JourneyFeedback = {
  id: string;
  submissionVersionId: string;
  status: "draft" | "released" | "superseded";
  origin: "teacher" | "ai-assisted";
  feedbackText: string;
  sourceDraftRevision: number;
};

describe("P1 critical closed-loop route journey", () => {
  it("publishes, persists, revises and accepts without exposing an AI draft", async () => {
    const state: {
      activityStatus: "draft" | "published";
      activityRevision: number;
      checkpointAttempted: boolean;
      submissionState?: LearningSubmissionState;
      versions: JourneyVersion[];
      feedback: JourneyFeedback[];
      eventCount: number;
    } = {
      activityStatus: "draft",
      activityRevision: 1,
      checkpointAttempted: false,
      versions: [],
      feedback: [],
      eventCount: 0,
    };

    const activityReadback = () => ({
      courseId,
      activity: {
        id: activityId,
        status: state.activityStatus,
        editRevision: state.activityRevision,
        version: 1,
      },
    });
    const activityScope = async () => ({ courseId, classId, lessonKey });
    const currentVersion = () => state.versions.at(-1);
    const submissionScope = async () => ({
      courseId,
      classId,
      lessonKey,
      activityId,
      currentVersionId: currentVersion()?.id ?? "missing-version",
    });
    const teacherSubmission = () => ({
      id: submissionId,
      state: state.submissionState,
      currentVersionId: currentVersion()?.id,
      courseId,
      classId,
      activityId,
      activity: {
        title: activityDraft.title,
        instructions: activityDraft.instructions,
        rubric: activityDraft.rubric,
        aiPolicy: "teacher-requested-draft",
      },
      versions: state.versions.map((version) => ({ ...version })),
      feedback: state.feedback.map((feedback) => ({ ...feedback })),
    });
    const unitReadback = () => ({
      unit: { courseId, classId, lessonKey, position: 1 },
      activity: { id: activityId, status: state.activityStatus, rubric: activityDraft.rubric },
      formative: { attempted: state.checkpointAttempted, attemptCount: state.checkpointAttempted ? 1 : 0 },
      submission: state.submissionState
        ? {
            id: submissionId,
            state: state.submissionState,
            currentVersionId: currentVersion()?.id,
            currentVersion: currentVersion(),
          }
        : null,
      feedback: state.feedback.filter((item) => item.status === "released"),
      completion: {
        completed: state.submissionState === "accepted",
        basis: "teacher-accepted-current-version",
      },
      playbackProgress: { status: "not-authoritative", percent: null },
      projectionVersion: state.eventCount,
      dataFreshAt: "2026-08-21T00:00:00.000Z",
    });

    const createActivity = createTeachingActivitiesPostHandler({
      env: {},
      authorize: async () => teacherAccess,
      createActivity: async (input) => {
        expect(input.draft).toMatchObject({ lessonKey, targetClassId: classId });
        return receipt(activityId, "draft", 1);
      },
      readActivity: async () => activityReadback(),
    });
    expect(
      await responseBody(
        await createActivity(
          writeRequest(`/api/teaching/courses/${courseId}/activities`, "POST", activityDraft, "activity-create-1"),
          { params: { courseId } },
        ),
        201,
      ),
    ).toMatchObject({ status: "persisted", activity: { status: "draft" } });

    const publishActivity = createTeachingActivityPatchHandler({
      env: {},
      readActivityScope: activityScope,
      authorize: async () => teacherAccess,
      updateActivity: async (input) => {
        expect(input).toMatchObject({ operation: "publish", expectedEditRevision: 1 });
        state.activityStatus = "published";
        state.activityRevision += 1;
        return receipt(activityId, "published", state.activityRevision);
      },
      readActivity: async () => activityReadback(),
    });
    await responseBody(
      await publishActivity(
        writeRequest(`/api/teaching/activities/${activityId}`, "PATCH", {
          operation: "publish",
          expectedEditRevision: 1,
        }, "activity-publish-1"),
        { params: { activityId } },
      ),
    );

    const readUnit = createLearningUnitGetHandler({
      env: {},
      authorize: async () => studentAccess,
      readStudentUnit: async () => unitReadback(),
    });
    expect(
      await responseBody(
        await readUnit(new Request(`http://localhost/api/learning/courses/${courseId}/units/${lessonKey}`), {
          params: { courseId, lessonKey },
        }),
      ),
    ).toMatchObject({ activity: { status: "published" }, feedback: [] });

    const recordCheckpoint = createFormativeAttemptPostHandler({
      env: {},
      readActivityScope: activityScope,
      authorize: async () => studentAccess,
      recordFormativeAttempt: async () => {
        state.checkpointAttempted = true;
        state.eventCount += 1;
        return { ...receipt("checkpoint-1", "attempted", 1), eventId: "event-checkpoint-1" };
      },
    });
    await responseBody(
      await recordCheckpoint(
        writeRequest(`/api/learning/activities/${activityId}/formative-attempt`, "POST", {
          response: { kind: "short-answer", text: "Evidence from the lesson." },
        }, "checkpoint-1"),
        { params: { activityId } },
      ),
    );

    const saveDraft = createSubmissionDraftPutHandler({
      env: {},
      readActivityScope: activityScope,
      authorize: async () => studentAccess,
      saveSubmissionDraft: async (input) => {
        expect(state.checkpointAttempted).toBe(true);
        let version = currentVersion();
        if (!version) {
          expect(input.expectedDraftRevision).toBe(0);
          version = { id: "version-1", versionNo: 1, status: "draft", contentText: "", draftRevision: 0 };
          state.versions.push(version);
          state.submissionState = "draft";
        } else if (state.submissionState === "revision_requested") {
          expect(input.expectedDraftRevision).toBe(0);
          assertSubmissionTransition({
            from: "revision_requested",
            to: "draft",
            versionNo: version.versionNo + 1,
            previousVersionNo: version.versionNo,
          });
          version = {
            id: `version-${version.versionNo + 1}`,
            versionNo: version.versionNo + 1,
            status: "draft",
            contentText: "",
            draftRevision: 0,
          };
          state.versions.push(version);
          state.submissionState = "draft";
        }
        expect(version.status).toBe("draft");
        expect(input.expectedDraftRevision).toBe(version.draftRevision);
        version.contentText = input.contentText;
        version.draftRevision += 1;
        return receipt(submissionId, "draft", version.draftRevision);
      },
    });
    const firstSave = await responseBody(
      await saveDraft(
        writeRequest(`/api/learning/activities/${activityId}/submission`, "PUT", {
          contentText: "V1 claim with evidence and reasoning.",
          expectedDraftRevision: 0,
        }),
        { params: { activityId } },
      ),
    );
    expect(firstSave).toMatchObject({ state: "draft", revision: 1 });

    const submitDraft = createSubmissionSubmitPostHandler({
      env: {},
      readActivityScope: activityScope,
      authorize: async () => studentAccess,
      submitSubmission: async (input) => {
        const version = currentVersion();
        expect(version?.status).toBe("draft");
        expect(input.expectedDraftRevision).toBe(version?.draftRevision);
        const nextState = version?.versionNo === 1 ? "submitted" : "resubmitted";
        assertSubmissionTransition({ from: "draft", to: nextState, versionNo: version?.versionNo ?? 0 });
        version!.status = "sealed";
        state.submissionState = nextState;
        state.eventCount += 1;
        return { ...receipt(submissionId, nextState, version!.versionNo), eventId: `event-submit-${version!.versionNo}` };
      },
    });
    await responseBody(
      await submitDraft(
        writeRequest(`/api/learning/activities/${activityId}/submission/submit`, "POST", {
          expectedDraftRevision: 1,
        }, "submit-v1"),
        { params: { activityId } },
      ),
    );
    expect(state.submissionState).toBe("submitted");
    expect(currentVersion()).toMatchObject({ versionNo: 1, status: "sealed" });

    const readQueue = createActivitySubmissionsGetHandler({
      env: {},
      readActivityScope: activityScope,
      authorize: async () => teacherAccess,
      listActivitySubmissions: async () => ({
        activityId,
        submissions: state.submissionState === "submitted"
          ? [{ id: submissionId, state: state.submissionState, currentVersionId: currentVersion()?.id }]
          : [],
        nextCursor: null,
        dataFreshAt: "2026-08-21T00:00:00.000Z",
      }),
    });
    expect(
      await responseBody(
        await readQueue(new Request(`http://localhost/api/teaching/activities/${activityId}/submissions?state=submitted`), {
          params: { activityId },
        }),
      ),
    ).toMatchObject({ submissions: [{ id: submissionId, state: "submitted" }] });

    const aiDraft = createAiFeedbackDraftPostHandler({
      env: {},
      readSubmissionScope: submissionScope,
      authorize: async () => teacherAccess,
      readTeacherSubmission: async () => teacherSubmission(),
      reserveAiFeedbackRequest: async () => ({ status: "reserved", requestHash: "a".repeat(64) }),
      failAiFeedbackRequest: async () => undefined,
      generate: async () => ({
        origin: "ai-assisted",
        rubricJudgments: { claim: "met", evidence: "partly-met", reasoning: "needs-revision" },
        feedbackText: "Add a clearer link between the evidence and the claim.",
        provider: "deepseek",
        model: "test-model",
        aiTraceRef: "b".repeat(64),
      }),
      saveFeedbackDraft: async (input) => {
        state.feedback.push({
          id: "feedback-ai-v1",
          submissionVersionId: input.expectedSubmissionVersionId,
          status: "draft",
          origin: "ai-assisted",
          feedbackText: input.feedbackText,
          sourceDraftRevision: 1,
        });
        return receipt("feedback-ai-v1", "draft", 1);
      },
    });
    await responseBody(
      await aiDraft(
        writeRequest(`/api/teaching/submissions/${submissionId}/ai-feedback-draft`, "POST", {
          expectedSubmissionVersionId: "version-1",
          expectedFeedbackRevision: 0,
        }, "ai-feedback-v1"),
        { params: { submissionId } },
      ),
    );
    const studentBeforeRelease = await responseBody(
      await readUnit(new Request(`http://localhost/api/learning/courses/${courseId}/units/${lessonKey}`), {
        params: { courseId, lessonKey },
      }),
    );
    expect(studentBeforeRelease).toMatchObject({ feedback: [] });

    const decide = createTeacherSubmissionDecisionPostHandler({
      env: {},
      readSubmissionScope: submissionScope,
      authorize: async () => teacherAccess,
      decideSubmission: async (input) => {
        const version = currentVersion()!;
        const nextState = input.decision === "accept" ? "accepted" : "revision_requested";
        assertSubmissionTransition({ from: state.submissionState!, to: nextState, versionNo: version.versionNo });
        for (const feedback of state.feedback) {
          if (feedback.status === "released" && feedback.submissionVersionId !== version.id) {
            feedback.status = "superseded";
          }
        }
        state.feedback.push({
          id: `feedback-released-v${version.versionNo}`,
          submissionVersionId: version.id,
          status: "released",
          origin: input.origin,
          feedbackText: input.feedbackText,
          sourceDraftRevision: 1,
        });
        state.submissionState = nextState;
        state.eventCount += 2;
        return { ...receipt(submissionId, nextState, version.versionNo), eventId: `event-decision-${version.versionNo}` };
      },
      readTeacherSubmission: async () => teacherSubmission(),
    });
    await responseBody(
      await decide(
        writeRequest(`/api/teaching/submissions/${submissionId}/decision`, "POST", {
          expectedSubmissionVersionId: "version-1",
          decision: "request-revision",
          feedbackText: "Please connect the evidence to the claim more explicitly.",
          rubricJudgments: { claim: "met", evidence: "partly-met", reasoning: "needs-revision" },
          origin: "ai-assisted",
        }, "decision-v1"),
        { params: { submissionId } },
      ),
    );
    expect(state.submissionState).toBe("revision_requested");
    expect(
      await responseBody(
        await readUnit(new Request(`http://localhost/api/learning/courses/${courseId}/units/${lessonKey}`), {
          params: { courseId, lessonKey },
        }),
      ),
    ).toMatchObject({
      submission: { state: "revision_requested" },
      feedback: [{ status: "released", submissionVersionId: "version-1" }],
      completion: { completed: false },
    });

    await responseBody(
      await saveDraft(
        writeRequest(`/api/learning/activities/${activityId}/submission`, "PUT", {
          contentText: "V2 now links the evidence directly to the claim.",
          expectedDraftRevision: 0,
        }),
        { params: { activityId } },
      ),
    );
    await responseBody(
      await submitDraft(
        writeRequest(`/api/learning/activities/${activityId}/submission/submit`, "POST", {
          expectedDraftRevision: 1,
        }, "submit-v2"),
        { params: { activityId } },
      ),
    );
    expect(state.submissionState).toBe("resubmitted");
    expect(state.versions).toMatchObject([
      { id: "version-1", status: "sealed" },
      { id: "version-2", status: "sealed" },
    ]);

    await responseBody(
      await decide(
        writeRequest(`/api/teaching/submissions/${submissionId}/decision`, "POST", {
          expectedSubmissionVersionId: "version-2",
          decision: "accept",
          feedbackText: "The revision now meets the learning intent.",
          rubricJudgments: { claim: "met", evidence: "met", reasoning: "met" },
          origin: "teacher",
        }, "decision-v2"),
        { params: { submissionId } },
      ),
    );
    expect(state.submissionState).toBe("accepted");
    expect(state.feedback).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ submissionVersionId: "version-1", status: "superseded" }),
        expect.objectContaining({ submissionVersionId: "version-2", status: "released" }),
      ]),
    );

    const dashboard = createLearningDashboardGetHandler({
      env: {},
      authorize: async () => ({
        status: "authorized" as const,
        reasonCode: "student-approved-memberships" as const,
        studentAccount: "student-1",
        scopes: [{ courseId, courseTitle: "Course one", classId }],
      }),
      readStudentDashboard: async () => ({
        courses: [{
          courseId,
          classId,
          units: [unitReadback()],
          nextAction: recommendNextLearningAction({
            units: [{ lessonKey, position: 1, checkpointAttempted: true, submissionState: state.submissionState }],
          }),
          projectionVersion: state.eventCount,
          dataFreshAt: "2026-08-21T00:00:00.000Z",
        }],
        nextAction: recommendNextLearningAction({
          units: [{ lessonKey, position: 1, checkpointAttempted: true, submissionState: state.submissionState }],
        }),
        dataFreshAt: "2026-08-21T00:00:00.000Z",
      }),
    });
    expect(
      await responseBody(await dashboard(new Request("http://localhost/api/learning/dashboard"))),
    ).toMatchObject({
      courses: [{ units: [{ completion: { completed: true } }] }],
      nextAction: { type: "course-complete" },
    });
    expect(state.eventCount).toBe(7);
  });
});

function receipt(resourceId: string, state: string, revision: number) {
  return {
    status: "persisted" as const,
    resourceId,
    state,
    revision,
    traceId: `trace-${resourceId}-${revision}`,
    persistedAt: "2026-08-21T00:00:00.000Z",
  };
}

function writeRequest(
  path: string,
  method: "POST" | "PUT" | "PATCH",
  body: unknown,
  idempotencyKey?: string,
) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function responseBody(response: Response, expectedStatus = 200) {
  const body = (await response.json()) as Record<string, unknown>;
  expect(response.status, JSON.stringify(body)).toBe(expectedStatus);
  return body;
}
