import {
  createLearningChatroomHistoryGetHandler,
  createLearningChatroomPostHandler,
} from "./handler";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = createLearningChatroomHistoryGetHandler();
export const POST = createLearningChatroomPostHandler();
