import {
  createLrsSmokeGetHandler,
  createLrsSmokePostHandler,
} from "./handler";

export const dynamic = "force-dynamic";

const getLrsSmoke = createLrsSmokeGetHandler();
const postLrsSmoke = createLrsSmokePostHandler();

export function GET(request: Request) {
  return getLrsSmoke(request);
}

export function POST(request: Request) {
  return postLrsSmoke(request);
}
