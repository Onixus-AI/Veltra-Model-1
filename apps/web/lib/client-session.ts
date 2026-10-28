"use client";

import { browserSupabase } from "@/lib/supabase";

const API_KEY_STORAGE_KEY = "veltra-api-key";

export async function readGatewayAuthorization(): Promise<string> {
  const supabase = browserSupabase();
  if (supabase) {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw new Error("Your session expired. Please sign in again.");
    if (data.session) return `Bearer ${data.session.access_token}`;
  }
  const apiKey = window.sessionStorage.getItem(API_KEY_STORAGE_KEY) ?? "";
  return apiKey ? `Bearer ${apiKey}` : "";
}

export async function gatewayAuthorizationHeaders(): Promise<HeadersInit> {
  const authorization = await readGatewayAuthorization();
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

/** End this browser's session without signing out the user's other devices. */
export async function signOutCurrentBrowser(): Promise<void> {
  // Remove the fallback first, including when the provider is unavailable.
  saveApiKey("");
  const supabase = browserSupabase();
  if (supabase) {
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) throw error;
  }
  window.sessionStorage.removeItem("veltra-password-recovery");
}
