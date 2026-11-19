// Replies that only report a failed request are shown to the person but never
// sent back to the model: a thread full of saved errors made the model repeat
// the error text instead of answering, even after the provider recovered.
const FAILURE_REPLY = [
  /^Onixus Workspace couldn[’']t complete this reply\b/,
  /^Onyx cannot (?:reach the Workspace AI service|reply because this workspace has no available AI credits|find this workspace[’']s credit account)\b/,
  /^Onyx could not verify this workspace[’']s credit account\b/,
  /^Please sign in again to continue chatting\.$/,
  /^\*\*Request failed:\*\*/,
];

export function isFailureReply(content: unknown): boolean {
  return typeof content === "string" && FAILURE_REPLY.some((pattern) => pattern.test(content.trim()));
}

export function withoutFailureReplies<T extends { role: string; content?: unknown }>(messages: T[]): T[] {
  return messages.filter((message) => !(message.role === "assistant" && isFailureReply(message.content)));
}
