export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type UaisHealthGetHandlerDeps = {
  now?: () => Date;
};

export const GET = createUaisHealthGetHandler();

export function createUaisHealthGetHandler(deps: UaisHealthGetHandlerDeps = {}) {
  return function GET() {
    return Response.json(
      {
        status: "ok",
        service: "uais",
        checkedAt: (deps.now ?? (() => new Date()))().toISOString(),
        checks: {
          app: "ok",
        },
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
        },
      },
      {
        status: 200,
        headers: {
          "cache-control": "no-store",
        },
      },
    );
  };
}
