import {
  readPptNarrationAudioAsset,
  type PptNarrationAudioAssetRead,
} from "@/lib/ai/voice/ppt-narration-assets";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  findPublishedLearningPptPlaybackAudio,
} from "@/lib/learning/ppt-playback-catalog";
import {
  authorizeLearningPptPlaybackAccess,
  createLearningPptPlaybackAccessDeniedResponse,
  createLearningPptPlaybackJsonResponse,
  createLearningPptPlaybackStoreErrorResponse,
  readSafeLearningPptPlaybackTraceId,
} from "@/lib/server/learning-ppt-playback-access";

type LearningPptPlaybackAudioRouteParams = {
  manifestId: string;
  audioId: string;
};

type LearningPptPlaybackAudioRouteContext = {
  params: Promise<LearningPptPlaybackAudioRouteParams>;
};

type LearningPptPlaybackAudioGetHandlerDeps = {
  env?: Record<string, string | undefined>;
  now?: Date;
  fetch?: typeof fetch;
  readPptNarrationAudioAsset?: (input: {
    manifestId: string;
    audioId: string;
  }) => Promise<PptNarrationAudioAssetRead>;
};

export function createLearningPptPlaybackAudioGetHandler(
  deps: LearningPptPlaybackAudioGetHandlerDeps = {},
) {
  const env = deps.env ?? process.env;
  const readAudioAsset = deps.readPptNarrationAudioAsset ?? readPptNarrationAudioAsset;

  return async function GET(
    request: Request,
    context: LearningPptPlaybackAudioRouteContext,
  ) {
    const traceId = readSafeLearningPptPlaybackTraceId(request);
    try {
      const params = await context.params;
      const publicAudio = findPublishedLearningPptPlaybackAudio(params);
      const access = await authorizeLearningPptPlaybackAccess({
        request,
        env,
        fetch: deps.fetch,
        now: deps.now,
        courseId: publicAudio.courseId,
      });
      if (access.status === "denied") {
        return createLearningPptPlaybackAccessDeniedResponse({ access, traceId });
      }
      const asset = await readAudioAsset({
        manifestId: params.manifestId,
        audioId: params.audioId,
      }).catch(() => undefined);

      if (!asset) {
        const bytes = await readPublishedAudioFile(publicAudio.publicPath);
        return createLearningAudioResponse({
          request,
          bytes,
          contentType: "audio/wav",
          filename: publicAudio.filename,
          cacheControl: "private, max-age=0, must-revalidate",
          traceId,
        });
      }

      return createLearningAudioResponse({
        request,
        bytes: asset.bytes,
        contentType: asset.contentType,
        filename: asset.filename,
        cacheControl: "private, max-age=0, must-revalidate",
        traceId,
      });
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
          error: "Learning PPT narration audio is not published.",
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

function createLearningAudioResponse(input: {
  request: Request;
  bytes: Buffer;
  contentType: string;
  filename: string;
  cacheControl: string;
  traceId: string;
}) {
  const totalLength = input.bytes.byteLength;
  const range = parseByteRange(input.request.headers.get("range"), totalLength);
  const headers = {
    "content-type": input.contentType,
    "content-disposition": `inline; filename="${input.filename}"`,
    "cache-control": input.cacheControl,
    "accept-ranges": "bytes",
    "x-uais-trace-id": input.traceId,
  };

  if (range === "unsatisfiable") {
    return new Response(null, {
      status: 416,
      headers: {
        ...headers,
        "content-range": `bytes */${totalLength}`,
      },
    });
  }

  if (range) {
    const chunk = input.bytes.subarray(range.start, range.end + 1);
    return new Response(toArrayBuffer(chunk), {
      status: 206,
      headers: {
        ...headers,
        "content-length": String(chunk.byteLength),
        "content-range": `bytes ${range.start}-${range.end}/${totalLength}`,
      },
    });
  }

  return new Response(toArrayBuffer(input.bytes), {
    headers: {
      ...headers,
      "content-length": String(totalLength),
    },
  });
}

function parseByteRange(rangeHeader: string | null, totalLength: number) {
  if (!rangeHeader) {
    return undefined;
  }

  const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
  if (!match || totalLength <= 0) {
    return "unsatisfiable";
  }

  const [, startText, endText] = match;
  if (!startText && !endText) {
    return "unsatisfiable";
  }

  if (!startText) {
    const suffixLength = parsePositiveInteger(endText);
    if (!suffixLength) {
      return "unsatisfiable";
    }
    return {
      start: Math.max(totalLength - suffixLength, 0),
      end: totalLength - 1,
    };
  }

  const start = parseNonNegativeInteger(startText);
  const end = endText ? parseNonNegativeInteger(endText) : totalLength - 1;
  if (start === undefined || end === undefined || start >= totalLength || end < start) {
    return "unsatisfiable";
  }

  return {
    start,
    end: Math.min(end, totalLength - 1),
  };
}

function parseNonNegativeInteger(value: string) {
  if (!/^\d+$/.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function parsePositiveInteger(value: string) {
  const parsed = parseNonNegativeInteger(value);
  return parsed && parsed > 0 ? parsed : undefined;
}

async function readPublishedAudioFile(publicPath: string) {
  const relativePublicPath = publicPath.replace(/^\/+/, "");
  return await readFile(join(process.cwd(), "public", relativePublicPath));
}

function toArrayBuffer(bytes: Buffer): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
