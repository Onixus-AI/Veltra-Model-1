// Shared by the web app and the Onixus Mail relay (copied there), so it has no dependencies.

export class RevenueError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const statusPrefix = /^(400|401|403|404|409|413|429|503):([\s\S]*)$/;

export function toRevenueError(error: unknown): RevenueError {
  if (error instanceof RevenueError) return error;
  const raw = error instanceof Error ? error.message : typeof error === 'object' && error && 'message' in error ? String((error as {message: unknown}).message) : '';
  const matched = statusPrefix.exec(raw.trim());
  if (matched) return new RevenueError(Number(matched[1]), matched[2].trim());
  const code = typeof error === 'object' && error && 'code' in error ? String((error as {code: unknown}).code) : '';
  if (code === '42501' || /permission denied|row-level security|not authorized/i.test(raw)) return new RevenueError(403, 'Your workspace role does not allow this action.');
  if (/does not exist|schema cache/i.test(raw)) return new RevenueError(503, 'The Onixus revenue system is not enabled for this workspace yet.');
  return new RevenueError(502, 'Onixus CRM could not complete this request. Refresh and try again.');
}
