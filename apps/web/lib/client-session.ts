"use client";

const API_KEY_STORAGE_KEY = "veltra-api-key";

function readSupabaseAccessToken(): string {
  const storageKeys = Object.keys(window.localStorage).filter((key) =>
    key.startsWith("sb-") && key.endsWith("-auth-token"),
  );
  if (storageKeys.length !== 1) return "";

  try {
    const session: unknown = JSON.parse(window.localStorage.getItem(storageKeys[0]) ?? "null");
    if (typeof session === "object" && session !== null && "access_token" in session) {
      const accessToken = session.access_token;
      return typeof accessToken === "string" ? accessToken : "";
    }
  } catch {
    return "";
  }

  return "";
}

export function readGatewayAuthorization(): string {
  const sessionToken = readSupabaseAccessToken();
  if (sessionToken) return `Bearer ${sessionToken}`;

  const apiKey = window.sessionStorage.getItem(API_KEY_STORAGE_KEY) ?? "";
  return apiKey ? `Bearer ${apiKey}` : "";
}

export function gatewayAuthorizationHeaders(): HeadersInit {
  const authorization = readGatewayAuthorization();
  return authorization ? { Authorization: authorization } : {};
}

export function readApiKey(): string {
  return window.sessionStorage.getItem(API_KEY_STORAGE_KEY) ?? "";
}

export function saveApiKey(apiKey: string): void {
  if (apiKey) {
    window.sessionStorage.setItem(API_KEY_STORAGE_KEY, apiKey.trim());
  } else {
    window.sessionStorage.removeItem(API_KEY_STORAGE_KEY);
  }
}
