import type { ChatMessage } from "@/data/uais";

export type ExportChatResult = {
  status: "mocked";
  fileName: string;
  messageCount: number;
};

export function exportChatToPdf(messages: ChatMessage[]): ExportChatResult {
  return {
    status: "mocked",
    fileName: "uais-human-ai-chat.pdf",
    messageCount: messages.length,
  };
}

export function createShareLink(groupId: string, baseUrl = "https://uais.top") {
  const normalizedBase = baseUrl.replace(/\/$/, "");
  return `${normalizedBase}/share/${encodeURIComponent(groupId)}`;
}
