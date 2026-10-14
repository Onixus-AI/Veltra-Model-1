"use client";

const API_KEY_STORAGE_KEY = "veltra-api-key";

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
