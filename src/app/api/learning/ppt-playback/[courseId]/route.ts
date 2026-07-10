import { after } from "next/server";
import {
  createLearningPptPlaybackManifestForCourse,
  createPublishedLearningPptPlaybackManifestForCourse,
} from "@/lib/learning/ppt-playback";
import {
  authorizeLearningPptPlaybackAccess,
  createLearningPptPlaybackAccessDeniedResponse,
  createLearningPptPlaybackJsonResponse,
  createLearningPptPlaybackStoreErrorResponse,
  readSafeLearningPptPlaybackTraceId,
} from "@/lib/server/learning-ppt-playback-access";
import {
  createLearningRecordQueue,
  type LearningRecordQueueItem,
} from "@/lib/learning-records/lrs-recorder";
import type { StoredPptNarrationAudioManifest } from "@/lib/ai/voice/ppt-narration-assets";
import type { LearningPptPlaybackManifest } from "@/lib/learning/ppt-playback-types";
import { defaultLocale, supportedLocales, type Locale } from "@/i18n/copy";

export const dynamic = "force-dynamic";

type LearningPptPlaybackManifestRouteParams = {
  courseId: string;
};

type LearningPptPlaybackManifestRouteContext = {
  params:
    | LearningPptPlaybackManifestRouteParams
    | Promise<LearningPptPlaybackManifestRouteParams>;
};

type LearningPptPlaybackManifestGetHandlerDeps = {
  env?: Record<string, string | undefined>;
  now?: Date;
  fetch?: typeof fetch;
  readStoredManifest?: () => Promise<StoredPptNarrationAudioManifest>;
  readPublishedManifest?: (input: {
    courseId: string;
    locale: Locale;
  }) => Promise<LearningPptPlaybackManifest | undefined>;
  recordLearningEvent?: (input: LearningRecordQueueItem) => void | Promise<void>;
};

type StudentLearningPptPlaybackAccess = Extract<
  Awaited<ReturnType<typeof authorizeLearningPptPlaybackAccess>>,
  { reasonCode: "student-course-membership-approved" }
>;

export const GET = createLearningPptPlaybackManifestGetHandler();

export function createLearningPptPlaybackManifestGetHandler(
  deps: LearningPptPlaybackManifestGetHandlerDeps = {},
) {
  const env = deps.env ?? process.env;

  return async function GET(
    request: Request,
    context: LearningPptPlaybackManifestRouteContext,
  ) {
    const traceId = readSafeLearningPptPlaybackTraceId(request);
    try {
      const params = await context.params;
      const access = await authorizeLearningPptPlaybackAccess({
        request,
        env,
        fetch: deps.fetch,
        now: deps.now,
        courseId: params.courseId,
      });
      if (access.status === "denied") {
        return createLearningPptPlaybackAccessDeniedResponse({ access, traceId });
      }
      const locale = getPlaybackLocale(request);
      const playback = deps.readStoredManifest
        ? createLearningPptPlaybackManifestForCourse({
            courseId: params.courseId,
            storedManifest: await deps.readStoredManifest(),
            locale,
          })
        : deps.readPublishedManifest
          ? await deps.readPublishedManifest({ courseId: params.courseId, locale })
          : createPublishedLearningPptPlaybackManifestForCourse(params.courseId, locale);

      if (!playback || playback.courseId !== params.courseId) {
        return createLearningPptPlaybackJsonResponse(
          404,
          {
            error: "Learning PPT playback is not published for this course.",
            traceId,
            redaction: {
              secrets: "omitted",
              localFiles: "omitted",
              assets: "published-learning-ids-only",
            },
          },
          traceId,
        );
      }

      if (access.reasonCode === "student-course-membership-approved") {
        recordPptPlaybackViewed({
          access,
          playback,
          locale,
          recordLearningEvent:
            deps.recordLearningEvent ??
            createDefaultLearningRecordEventRecorder({
              env,
              fetch: deps.fetch,
            }),
        });
      }

      return createLearningPptPlaybackJsonResponse(200, {
        playback,
        access,
        traceId,
      }, traceId);
    } catch (error) {
      const storeErrorResponse = createLearningPptPlaybackStoreErrorResponse({
        error,
        traceId,
      });
      if (storeErrorResponse) {
        return storeErrorResponse;
      }
      return createLearningPptPlaybackJsonResponse(
        404,
        {
          error: "Learning PPT playback manifest is not available.",
          traceId,
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "published-learning-ids-only",
          },
        },
        traceId,
      );
    }
  };
}

function recordPptPlaybackViewed(input: {
  access: StudentLearningPptPlaybackAccess;
  playback: LearningPptPlaybackManifest;
  locale: Locale;
  recordLearningEvent: (item: LearningRecordQueueItem) => void | Promise<void>;
}) {
  const item: LearningRecordQueueItem = {
    actor: {
      id: input.access.actor.actorId,
      role: "learner",
    },
    event: {
      type: "lesson.viewed",
      object: {
        id: `${input.playback.courseId}/ppt-playback/${input.playback.audioManifestId}`,
        name: `${getStableEnglishPlaybackTitle(input.playback)} PPT playback`,
        type: "lesson",
      },
      result: {
        completion: true,
        success: true,
      },
      context: {
        courseId: input.playback.courseId,
        classId: input.access.classId,
        lessonId: input.playback.audioManifestId,
        locale: input.locale,
      },
    },
    idempotencyKey: [
      input.access.actor.actorId,
      input.playback.courseId,
      input.playback.audioManifestId,
      "manifest-viewed",
    ].join(":"),
  };
  void Promise.resolve(input.recordLearningEvent(item)).catch(() => undefined);
}

function getStableEnglishPlaybackTitle(playback: LearningPptPlaybackManifest) {
  return (
    createPublishedLearningPptPlaybackManifestForCourse(playback.courseId, "en-US")
      ?.courseTitle ?? playback.courseTitle
  );
}

function createDefaultLearningRecordEventRecorder(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
}) {
  const queue = createLearningRecordQueue({
    env: input.env,
    fetch: input.fetch,
  });
  return (item: LearningRecordQueueItem) => {
    queue.enqueue(item);
    scheduleLearningRecordFlush(queue);
  };
}

function scheduleLearningRecordFlush(queue: { flush: () => Promise<unknown> }) {
  // Keep the async LRS write alive past the response so serverless runtimes do
  // not freeze the function before the flush completes; fall back to a detached
  // flush when `after` is unavailable (e.g. outside a request scope).
  try {
    after(async () => {
      await queue.flush().catch(() => undefined);
    });
  } catch {
    void queue.flush().catch(() => undefined);
  }
}

function getPlaybackLocale(request: Request): Locale {
  const requestedLocale = new URL(request.url).searchParams.get("locale");
  if (isSupportedLocale(requestedLocale)) {
    return requestedLocale;
  }

  const acceptedLanguage = request.headers.get("accept-language") ?? "";
  const acceptedLocale = supportedLocales.find((locale) =>
    acceptedLanguage.toLowerCase().includes(locale.toLowerCase()),
  );

  return acceptedLocale ?? defaultLocale;
}

function isSupportedLocale(value: string | null): value is Locale {
  return supportedLocales.some((locale) => locale === value);
}
