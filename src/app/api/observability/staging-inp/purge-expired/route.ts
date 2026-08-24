import { createStagingInpExpiryPurgeHandler } from "@/lib/server/uais-staging-inp-expiry-route-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const GET = createStagingInpExpiryPurgeHandler();
