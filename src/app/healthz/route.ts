import { createUaisHealthGetHandler } from "./handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = createUaisHealthGetHandler();
