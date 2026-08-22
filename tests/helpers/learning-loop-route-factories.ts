import { POST as formativeAttemptPost } from "@/app/api/learning/activities/[activityId]/formative-attempt/route";
import { PUT as submissionDraftPut } from "@/app/api/learning/activities/[activityId]/submission/route";
import { POST as submissionSubmitPost } from "@/app/api/learning/activities/[activityId]/submission/submit/route";
import { GET as learningUnitGet } from "@/app/api/learning/courses/[courseId]/units/[lessonKey]/route";
import { GET as learningDashboardGet } from "@/app/api/learning/dashboard/route";
import { PATCH as teachingActivityPatch } from "@/app/api/teaching/activities/[activityId]/route";
import { GET as activitySubmissionsGet } from "@/app/api/teaching/activities/[activityId]/submissions/route";
import {
  GET as teachingActivitiesGet,
  POST as teachingActivitiesPost,
} from "@/app/api/teaching/courses/[courseId]/activities/route";
import { GET as learningInsightsGet } from "@/app/api/teaching/courses/[courseId]/learning-insights/route";
import { POST as aiFeedbackDraftPost } from "@/app/api/teaching/submissions/[submissionId]/ai-feedback-draft/route";
import { POST as teacherSubmissionDecisionPost } from "@/app/api/teaching/submissions/[submissionId]/decision/route";
import { PUT as teacherFeedbackPut } from "@/app/api/teaching/submissions/[submissionId]/feedback/route";
import { GET as teacherSubmissionGet } from "@/app/api/teaching/submissions/[submissionId]/route";
import { POST as learningOutboxDispatchPost } from "@/app/api/learning-records/outbox/dispatch/route";
import { POST as learningOutboxReplayPost } from "@/app/api/learning-records/outbox/replay/route";

export const createFormativeAttemptPostHandler = formativeAttemptPost.createForTesting;
export const createSubmissionDraftPutHandler = submissionDraftPut.createForTesting;
export const createSubmissionSubmitPostHandler = submissionSubmitPost.createForTesting;
export const createLearningUnitGetHandler = learningUnitGet.createForTesting;
export const createLearningDashboardGetHandler = learningDashboardGet.createForTesting;
export const createTeachingActivityPatchHandler = teachingActivityPatch.createForTesting;
export const createActivitySubmissionsGetHandler = activitySubmissionsGet.createForTesting;
export const createTeachingActivitiesGetHandler = teachingActivitiesGet.createForTesting;
export const createTeachingActivitiesPostHandler = teachingActivitiesPost.createForTesting;
export const createLearningInsightsGetHandler = learningInsightsGet.createForTesting;
export const createAiFeedbackDraftPostHandler = aiFeedbackDraftPost.createForTesting;
export const createTeacherSubmissionDecisionPostHandler =
  teacherSubmissionDecisionPost.createForTesting;
export const createTeacherFeedbackPutHandler = teacherFeedbackPut.createForTesting;
export const createTeacherSubmissionGetHandler = teacherSubmissionGet.createForTesting;
export const createLearningOutboxDispatchPostHandler =
  learningOutboxDispatchPost.createForTesting;
export const createLearningOutboxReplayPostHandler =
  learningOutboxReplayPost.createForTesting;
