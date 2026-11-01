"use client";
import { useEffect, useRef, useState } from "react";
import { Palette, X } from "lucide-react";
import {
  defaultAppearance,
  type Appearance,
} from "@/lib/workspace-appearance";
import {useWorkspaceSettings} from "./workspace-settings-provider";
function apply(value: Appearance) {
  const root = document.documentElement;
  root.dataset.workspaceAccent = value.accent;
  root.dataset.workspaceDensity = value.density;
  root.dataset.workspaceTheme = value.theme;
}
/** Restores appearance even in embedded documents that have no navigation. */
export function WorkspaceAppearanceSync() {
  const {appearance}=useWorkspaceSettings();
  useEffect(()=>apply(appearance),[appearance]);
  return null;
}
export default function WorkspaceAppearance({
  navigation = false,
}: {
  navigation?: boolean;
}) {
  const settings=useWorkspaceSettings(),value=settings.appearance;
  const [open,setOpen]=useState(false),[error,setError]=useState('');
  const account=useRef(settings.userId);account.current=settings.userId;
  useEffect(()=>{setOpen(false);setError('');},[settings.userId]);
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
  function change(next:Appearance){const userId=account.current;setError('');void settings.saveAppearance(next).catch(e=>{if(account.current===userId)setError(e.message);});}
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="header-icon"
        aria-label="Customize appearance"
        aria-haspopup="dialog"
        disabled={!settings.canSave}
        onClick={()=>{setError('');setOpen(true);}}
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
        <p>{settings.account?'Appearance changes save to your account across devices.':'One appearance across your workspace. Saved in this browser.'}</p>
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
        {settings.pending&&<p role="status">Saving appearance…</p>}
        {(error||settings.error)&&<p role="alert">{error||settings.error}<button type="button" onClick={()=>change(value)}>Retry saving appearance</button></p>}
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
