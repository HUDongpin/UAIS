import { isDraftMediaSlides, type DraftMediaSlide } from "./unit-draft-media";

export type TeachingUnitDraftContent = {
  mediaSlides?: DraftMediaSlide[];
  title: string;
  objectives: string[];
  activities: Array<{
    title: string;
    durationMinutes: number;
    instructions: string;
  }>;
  lectureScript: string;
  questions: Array<{
    prompt: string;
    referenceAnswer: string;
  }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

export function isTeachingUnitDraftContent(value: unknown): value is TeachingUnitDraftContent {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["title", "objectives", "activities", "lectureScript", "questions", ...(Object.hasOwn(value, "mediaSlides") ? ["mediaSlides"] : [])]) ||
    (Object.hasOwn(value, "mediaSlides") && !isDraftMediaSlides(value.mediaSlides)) ||
    !isText(value.title, 200) ||
    !isText(value.lectureScript, 50_000) ||
    !Array.isArray(value.objectives) || value.objectives.length < 1 || value.objectives.length > 12 ||
    !value.objectives.every((objective) => isText(objective, 2_000)) ||
    !Array.isArray(value.activities) || value.activities.length < 1 || value.activities.length > 12 ||
    !value.activities.every((activity: unknown) => (
      isRecord(activity) &&
      hasOnlyKeys(activity, ["title", "durationMinutes", "instructions"]) &&
      isText(activity.title, 200) &&
      typeof activity.durationMinutes === "number" &&
      Number.isSafeInteger(activity.durationMinutes) &&
      activity.durationMinutes >= 1 && activity.durationMinutes <= 240 &&
      isText(activity.instructions, 6_000)
    )) ||
    !Array.isArray(value.questions) || value.questions.length < 1 || value.questions.length > 20 ||
    !value.questions.every((question: unknown) => (
      isRecord(question) &&
      hasOnlyKeys(question, ["prompt", "referenceAnswer"]) &&
      isText(question.prompt, 4_000) &&
      isText(question.referenceAnswer, 6_000)
    ))
  ) {
    return false;
  }
  // Bound the whole editable document as well as each individual field.
  const textContent = { title: value.title, objectives: value.objectives, activities: value.activities, lectureScript: value.lectureScript, questions: value.questions };
  return JSON.stringify(textContent).length <= 60_000;
}
