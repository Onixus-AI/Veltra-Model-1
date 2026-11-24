/**
 * Onixus is the one login for Onixus Workspace.
 *
 * Workspace sends the person to the Onixus client login with a one-time state
 * kept in this tab. Onixus sends them back to /onixus/handoff with their Onixus
 * session in the URL fragment. The state must match, so nobody can sign a
 * visitor into someone else's Workspace by sending them a crafted link.
 */
export const ONIXUS_ORIGIN = "https://www.onixus.xyz";
const STATE_KEY = "onixus-signin-state";
const STATE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;

export function onixusSignInUrl(returnOrigin: string, storage: Storage, newState: () => string = () => crypto.randomUUID()): string {
  const state = newState();
  storage.setItem(STATE_KEY, state);
  const params = new URLSearchParams({ state, return: returnOrigin });
  return `${ONIXUS_ORIGIN}/workspace/continue?${params.toString()}`;
}

/** Reads and consumes an Onixus return. Returns the token only when the state is ours. */
export function readOnixusReturn(hash: string, storage: Storage): { token: string } | { error: string } | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const token = params.get("onixus_token");
  if (!token) return null;
  const expected = storage.getItem(STATE_KEY);
  storage.removeItem(STATE_KEY);
  const state = params.get("state") ?? "";
  if (!expected || !STATE.test(state) || state !== expected) {
    return { error: "This sign-in link has expired. Choose Continue with Onixus again." };
  }
  return { token };
}
