import { createStagingInpPostHandler } from "@/lib/server/uais-staging-inp-route-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const POST = createStagingInpPostHandler();
