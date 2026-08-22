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
import type { StoredPptNarrationAudioManifest } from "@/lib/ai/voice/ppt-narration-assets";
import type { LearningPptPlaybackManifest } from "@/lib/learning/ppt-playback-types";
import { defaultLocale, supportedLocales, type Locale } from "@/i18n/copy";

export const dynamic = "force-dynamic";

type LearningPptPlaybackManifestRouteParams = {
  courseId: string;
};

type LearningPptPlaybackManifestRouteContext = {
  params: Promise<LearningPptPlaybackManifestRouteParams>;
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
};

export const GET = Object.assign(createLearningPptPlaybackManifestGetHandler(), {
  createForTesting: createLearningPptPlaybackManifestGetHandler,
});

function createLearningPptPlaybackManifestGetHandler(
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
