import {
  createLearningChatroomPostHandler,
} from "./handler";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Keep the legacy read URL during migration without exposing a second,
// independently-counted history limiter. Fetch follows this same-origin 307
// automatically and every store read is then admitted by the dedicated route.
export function GET(request: Request) {
  const url = new URL(request.url);
  const traceId = readSafeLearningChatroomRedirectTraceId(request);
  return new Response(null, {
    status: 307,
    headers: {
      "cache-control": "no-store",
      location: `/api/learning/chatroom/history${url.search}`,
      "x-uais-trace-id": traceId,
    },
  });
}

function readSafeLearningChatroomRedirectTraceId(request: Request) {
  const supplied = request.headers.get("x-uais-trace-id")?.trim();
  if (supplied && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(supplied)) {
    return supplied;
  }
  return `trace-learning-chatroom-${crypto.randomUUID()}`;
}

export const POST = createLearningChatroomPostHandler();
