import {
  readPptNarrationAudioAsset,
  type PptNarrationAudioAssetRead,
} from "@/lib/ai/voice/ppt-narration-assets";
import {
  assertUaisAiAccess,
  createUaisAiAccessDeniedResponse,
  isUaisAiAccessDeniedError,
} from "@/lib/server/ai-access-control";

export const dynamic = "force-dynamic";

type PptNarrationAudioRouteParams = {
  manifestId: string;
  audioId: string;
};

type PptNarrationAudioRouteContext = {
  params: PptNarrationAudioRouteParams | Promise<PptNarrationAudioRouteParams>;
};

type PptNarrationAudioGetHandlerDeps = {
  readPptNarrationAudioAsset?: (input: {
    manifestId: string;
    audioId: string;
  }) => Promise<PptNarrationAudioAssetRead>;
};

export const GET = createPptNarrationAudioGetHandler();

export function createPptNarrationAudioGetHandler(
  deps: PptNarrationAudioGetHandlerDeps = {},
) {
  const readAudioAsset = deps.readPptNarrationAudioAsset ?? readPptNarrationAudioAsset;

  return async function GET(request: Request, context: PptNarrationAudioRouteContext) {
    try {
      const params = await context.params;
      assertUaisAiAccess({
        request,
        action: "ppt-narration-audio-download",
        resource: {
          audioManifestId: params.manifestId,
          audioId: params.audioId,
        },
        requireSignedSession: true,
      });
      const asset = await readAudioAsset({
        manifestId: params.manifestId,
        audioId: params.audioId,
      });

      return new Response(toArrayBuffer(asset.bytes), {
        headers: {
          "content-type": asset.contentType,
          "content-length": String(asset.byteLength),
          "content-disposition": `attachment; filename="${asset.filename}"`,
          "cache-control": "private, max-age=0, must-revalidate",
        },
      });
    } catch (error) {
      if (isUaisAiAccessDeniedError(error)) {
        return createUaisAiAccessDeniedResponse(error);
      }
      return Response.json({ error: "PPT narration audio asset was not found." }, { status: 404 });
    }
  };
}

function toArrayBuffer(bytes: Buffer): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
