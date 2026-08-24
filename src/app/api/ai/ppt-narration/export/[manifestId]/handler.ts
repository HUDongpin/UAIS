import {
  createPptNarrationExportPackage,
  type CreatePptNarrationExportPackageInput,
  type PptNarrationExportPackage,
} from "@/lib/ai/voice/ppt-narration-export-package";
import {
  assertUaisAiAccess,
  createUaisAiAccessDeniedResponse,
  isUaisAiAccessDeniedError,
} from "@/lib/server/ai-access-control";

type PptNarrationExportRouteParams = {
  manifestId: string;
};

type PptNarrationExportRouteContext = {
  params: Promise<PptNarrationExportRouteParams>;
};

type PptNarrationExportGetHandlerDeps = {
  createPptNarrationExportPackage?: (
    input: CreatePptNarrationExportPackageInput,
  ) => Promise<PptNarrationExportPackage>;
};

export function createPptNarrationExportGetHandler(
  deps: PptNarrationExportGetHandlerDeps = {},
) {
  const createExportPackage = deps.createPptNarrationExportPackage ?? createPptNarrationExportPackage;

  return async function GET(request: Request, context: PptNarrationExportRouteContext) {
    try {
      const params = await context.params;
      assertUaisAiAccess({
        request,
        action: "ppt-narration-export-download",
        resource: {
          audioManifestId: params.manifestId,
        },
        requireSignedSession: true,
      });
      const exportPackage = await createExportPackage({
        manifestId: params.manifestId,
      });

      return new Response(toArrayBuffer(exportPackage.bytes), {
        headers: {
          "content-type": exportPackage.contentType,
          "content-length": String(exportPackage.byteLength),
          "content-disposition": `attachment; filename="${exportPackage.filename}"`,
          "cache-control": "private, max-age=0, must-revalidate",
        },
      });
    } catch (error) {
      if (isUaisAiAccessDeniedError(error)) {
        return createUaisAiAccessDeniedResponse(error);
      }
      return Response.json(
        { error: "PPT narration export package was not found." },
        { status: 404 },
      );
    }
  };
}

function toArrayBuffer(bytes: Buffer): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
