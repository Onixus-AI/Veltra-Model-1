"use client";
import { useEffect, useRef, useState } from "react";
import { Palette, X } from "lucide-react";
import {
  defaultAppearance,
  readAppearance,
  type Appearance,
} from "@/lib/workspace-appearance";
const key = "veltra-appearance-v1",
  changed = "onixus:appearance-changed";
function apply(value: Appearance) {
  const root = document.documentElement;
  root.dataset.workspaceAccent = value.accent;
  root.dataset.workspaceDensity = value.density;
  root.dataset.workspaceTheme = value.theme;
}
/** Restores appearance even in embedded documents that have no navigation. */
export function WorkspaceAppearanceSync() {
  useEffect(() => {
    const restore = () => {
      try {
        const value = JSON.parse(localStorage.getItem(key) || "null");
        const migrated = value?.theme
          ? value
          : {
              ...value,
              theme:
                localStorage.getItem("onixus-overview-theme") === "day"
                  ? "light"
                  : "dark",
            };
        apply(readAppearance(migrated));
      } catch {
        apply(defaultAppearance);
      }
    };
    restore();
    window.addEventListener("storage", restore);
    window.addEventListener(changed, restore);
    return () => {
      window.removeEventListener("storage", restore);
      window.removeEventListener(changed, restore);
    };
  }, []);
  return null;
}
export default function WorkspaceAppearance({
  navigation = false,
}: {
  navigation?: boolean;
}) {
  const [value, setValue] = useState<Appearance>(defaultAppearance),
    [open, setOpen] = useState(false),
    [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  function close() {
    setOpen(false);
    trigger.current?.focus();
  }
  function change(next: Appearance) {
    setValue(next);
    apply(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
      window.dispatchEvent(new Event(changed));
      setError("");
    } catch {
      setError(
        "Appearance changed for this visit. Your browser could not save it.",
      );
    }
  }
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="header-icon"
        aria-label="Customize appearance"
        aria-haspopup="dialog"
        onClick={() => {
          try {
            setValue(
              readAppearance(JSON.parse(localStorage.getItem(key) || "null")),
            );
          } catch {
            setValue(defaultAppearance);
          }
          setOpen(true);
        }}
      >
        <Palette size={18} />
        {navigation && <span>Appearance</span>}
      </button>
      <dialog
        ref={dialog}
        className="appearance-dialog"
        aria-labelledby="appearance-title"
        onCancel={close}
        onClose={() => setOpen(false)}
      >
        <header>
          <h2 id="appearance-title">Appearance</h2>
          <button
            type="button"
            aria-label="Close appearance settings"
            onClick={close}
          >
            <X size={18} />
          </button>
        </header>
        <p>One appearance across your workspace. Saved in this browser.</p>
        <label>
          Theme
          <select
            value={value.theme}
            onChange={(event) =>
              change({
                ...value,
                theme: event.target.value as Appearance["theme"],
              })
            }
          >
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </label>
        <fieldset>
          <legend>Accent color</legend>
          <div className="accent-choices">
            {(
              [
                "cyan",
                "magenta",
                "lemon",
                "purple",
                "lime",
                "orange",
                "red",
              ] as const
            ).map((accent) => (
              <button
                type="button"
                key={accent}
                data-accent={accent}
                aria-pressed={value.accent === accent}
                onClick={() => change({ ...value, accent })}
              >
                {accent === "lemon" ? "Lemon yellow" : accent}
              </button>
            ))}
          </div>
        </fieldset>
        <label>
          Layout density
          <select
            value={value.density}
            onChange={(event) =>
              change({
                ...value,
                density: event.target.value as Appearance["density"],
              })
            }
          >
            <option value="comfortable">Comfortable</option>
            <option value="compact">Compact</option>
          </select>
        </label>
        {error && <p role="status">{error}</p>}
        <footer>
          <button type="button" onClick={() => change(defaultAppearance)}>
            Reset appearance
          </button>
          <button type="button" className="primary" onClick={close}>
            Done
          </button>
        </footer>
      </dialog>
    </>
  );
}
