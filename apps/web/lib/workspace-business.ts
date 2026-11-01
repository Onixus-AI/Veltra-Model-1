"use client";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { workspaceBusiness } from "./workspace-navigation";
const key = "veltra-home-business",
  eventName = "onixus:business-changed";
/** A navigation preference only. Every data service must still verify membership. */
export function currentBusiness() {
  const supplied = workspaceBusiness(window.location.search);
  if (supplied) return supplied;
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}
export function rememberBusiness(business: string) {
  try {
    localStorage.setItem(key, business);
  } catch {}
  window.dispatchEvent(new CustomEvent(eventName, { detail: business }));
}
export function useWorkspaceBusiness() {
  const [business, setBusiness] = useState(""),
    pathname = usePathname();
  useEffect(() => {
    const restore = () => setBusiness(currentBusiness());
    const changed = (event: Event) =>
      setBusiness((event as CustomEvent<string>).detail);
    const storage = (event: StorageEvent) => {
      if (event.key === key || event.key === null) restore();
    };
    restore();
    window.addEventListener(eventName, changed);
    window.addEventListener("popstate", restore);
    window.addEventListener("storage", storage);
    return () => {
      window.removeEventListener(eventName, changed);
      window.removeEventListener("popstate", restore);
      window.removeEventListener("storage", storage);
    };
  }, [pathname]);
  return business;
}
