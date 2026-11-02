"use client";
import { useEffect, useRef, useState, type RefObject } from "react";
/** Shared mobile navigation focus behavior; native child dialogs keep their own trap. */
export function useWorkspaceDrawer(
  open: boolean,
  onClose: () => void,
  panel: RefObject<HTMLElement | null>,
  trigger: RefObject<HTMLButtonElement | null>,
) {
  const [mobile, setMobile] = useState(false),
    close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const media = window.matchMedia("(max-width:760px)"),
      sync = () => setMobile(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  useEffect(() => {
    if (!open || !mobile) return;
    panel.current?.querySelector<HTMLElement>("a,button")?.focus();
    const key = (event: KeyboardEvent) => {
      if (document.querySelector("dialog[open]")) return;
      if (event.key === "Escape") {
        event.preventDefault();
        close.current();
        trigger.current?.focus();
      }
      if (event.key === "Tab") {
        const controls = Array.from(
            panel.current?.querySelectorAll<HTMLElement>(
              "a[href],button:not(:disabled)",
            ) ?? [],
          ).filter((element) => element.getClientRects().length > 0),
          first = controls[0],
          last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [open, mobile, panel, trigger]);
  return mobile;
}
