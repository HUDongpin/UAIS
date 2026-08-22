import type {
  LearningActivityDraft,
  LearningFormativeCheckpoint,
  LearningRubricDimension,
  LearningSubmissionState,
  RubricJudgmentState,
} from "@/lib/learning-loop/domain";

export type TeacherLearningActivity = {
  id: string;
  activityKey: string;
  version: number;
  editRevision: number;
  status: "draft" | "published" | "archived";
  lessonKey: string;
  lessonPosition: number;
  targetClassId: string;
  title: LearningActivityDraft["title"];
  instructions: LearningActivityDraft["instructions"];
  rubric: LearningRubricDimension[];
  checkpoint: LearningFormativeCheckpoint;
  dueAt?: string;
  aiPolicy: LearningActivityDraft["aiPolicy"];
  revisionPolicy: "teacher-requested";
  updatedAt?: string;
};

export type TeacherCourseClass = {
  classId: string;
  className: string;
};

export type TeacherSubmissionQueueRow = {
  id: string;
  state: LearningSubmissionState;
  currentVersionNo: number;
  currentVersionId: string;
  student: { account: string; displayName: string };
  classId: string;
  formative: { attempted: boolean; attemptCount: number };
  lastSubmittedAt?: string;
  updatedAt?: string;
};

export type TeacherSubmissionVersion = {
  id: string;
  versionNo: number;
  status: "draft" | "sealed";
  contentText: string;
  draftRevision: number;
  submittedAt?: string;
};

export type TeacherFeedback = {
  id: string;
  submissionVersionId: string;
  origin: "teacher" | "ai-assisted";
  status: "draft" | "released" | "superseded";
  rubricJudgments: Record<string, RubricJudgmentState>;
  feedbackText: string;
  requiresRevision: boolean;
  sourceDraftRevision: number;
  aiAssisted: boolean;
  releasedAt?: string;
};

export type TeacherSubmissionDetail = {
  id: string;
  state: LearningSubmissionState;
  currentVersionNo: number;
  currentVersionId: string;
  student: { account: string; displayName: string };
  courseId: string;
  classId: string;
  activityId: string;
  lessonKey: string;
  activity: {
    title: LearningActivityDraft["title"];
    instructions: LearningActivityDraft["instructions"];
    rubric: LearningRubricDimension[];
    aiPolicy: LearningActivityDraft["aiPolicy"];
  };
  formative: { attempted: boolean; attemptCount: number };
  versions: TeacherSubmissionVersion[];
  feedback: TeacherFeedback[];
  dataFreshAt: string;
};

export type LearningInsights = {
  counts: {
    notStarted: number;
    draft: number;
    submitted: number;
    revisionRequested: number;
    resubmitted: number;
    accepted: number;
    overdue: number;
  };
  projectionVersion: number;
  dataFreshAt: string;
};
