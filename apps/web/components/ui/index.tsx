"use client";

import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";

type Action = { label: string; onClick: () => void };

export function Button({ tone = "secondary", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "primary" | "secondary" | "quiet" | "danger" }) {
  return <button type="button" {...props} className={`ui-button ui-button-${tone} ${className}`.trim()} />;
}

export function PillButton(props: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "primary" | "secondary" | "quiet" | "danger" }) {
  return <Button {...props} />;
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`ui-card ${className}`.trim()}>{children}</section>;
}

export function MonoLabel({ children }: { children: ReactNode }) {
  return <span className="ui-mono-label">{children}</span>;
}

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: Action }) {
  return <header className="ui-page-header"><div><h1>{title}</h1>{description && <p>{description}</p>}</div>{action && <Button tone="primary" onClick={action.onClick}>{action.label}</Button>}</header>;
}

export function Tabs({ items, selected, onSelect, label }: { items: { id: string; label: string }[]; selected: string; onSelect: (id: string) => void; label: string }) {
  return <div className="ui-tabs" role="tablist" aria-label={label}>{items.map((item) => <button key={item.id} type="button" role="tab" aria-selected={item.id === selected} onClick={() => onSelect(item.id)}>{item.label}</button>)}</div>;
}

export function Table({ headers, children }: { headers: string[]; children: ReactNode }) {
  return <div className="ui-table-scroll"><table className="ui-table"><thead><tr>{headers.map((header) => <th scope="col" key={header}>{header}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;
}

export function StatusBadge({ state, detail }: { state: "connected" | "attention" | "off"; detail?: string }) {
  const names = { connected: "Connected", attention: "Needs attention", off: "Off" };
  return <span className="ui-status-badge" data-state={state}><span className="ui-status-dot" aria-hidden="true" />{names[state]}{detail && <span className="ui-status-detail">· {detail}</span>}</span>;
}

export function EmptyState({ title, detail, action }: { title: string; detail?: string; action?: Action }) {
  return <div className="ui-empty-state"><h2>{title}</h2>{detail && <p>{detail}</p>}{action && <Button tone="secondary" onClick={action.onClick}>{action.label}</Button>}</div>;
}

function useModal(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; if (!dialog) return; if (open && !dialog.open) dialog.showModal(); if (!open && dialog.open) dialog.close(); }, [open]);
  useEffect(() => { const dialog = ref.current; if (!dialog) return; const cancel = (event: Event) => { event.preventDefault(); onClose(); }; dialog.addEventListener("cancel", cancel); return () => dialog.removeEventListener("cancel", cancel); }, [onClose]);
  return ref;
}

export function ConfirmDialog({ open, title, description, confirmLabel = "Confirm", danger = false, onConfirm, onClose }: { open: boolean; title: string; description: string; confirmLabel?: string; danger?: boolean; onConfirm: () => void; onClose: () => void }) {
  const ref = useModal(open, onClose);
  return <dialog ref={ref} className="ui-dialog" aria-labelledby="ui-confirm-title"><h2 id="ui-confirm-title">{title}</h2><p>{description}</p><div className="ui-dialog-actions"><Button tone="quiet" onClick={onClose}>Cancel</Button><Button tone={danger ? "danger" : "primary"} onClick={onConfirm}>{confirmLabel}</Button></div></dialog>;
}

export function Drawer({ open, title, children, onClose }: { open: boolean; title: string; children: ReactNode; onClose: () => void }) {
  const ref = useModal(open, onClose);
  return <dialog ref={ref} className="ui-drawer" aria-labelledby="ui-drawer-title"><header><h2 id="ui-drawer-title">{title}</h2><Button tone="quiet" aria-label="Close panel" onClick={onClose}>Close</Button></header>{children}</dialog>;
}

export function Toast({ message, tone = "neutral" }: { message: string; tone?: "neutral" | "error" | "success" }) {
  return <p className="ui-toast" data-tone={tone} role={tone === "error" ? "alert" : "status"}>{message}</p>;
}

export function Skeleton() { return <span className="ui-skeleton" aria-hidden="true" />; }

export function DecisionRow({ source, time, title, detail, action }: { source: string; time: string; title: string; detail?: string; action?: Action }) {
  return <article className="ui-decision-row"><span className="ui-decision-ring" aria-hidden="true" /><div><p className="ui-decision-meta"><MonoLabel>{source}</MonoLabel> <time>{time}</time></p><h3>{title}</h3>{detail && <p>{detail}</p>}</div>{action && <Button tone="primary" onClick={action.onClick}>{action.label}</Button>}</article>;
}

export function AgentCard({ name, state, detail, children }: { name: string; state: "working" | "idle" | "attention"; detail: string; children?: ReactNode }) {
  return <section className="ui-agent-card"><header><strong>{name}</strong><span className="ui-agent-state" data-state={state}><span className="ui-status-dot" aria-hidden="true" />{state}</span></header><p>{detail}</p>{children}</section>;
}

export function ChatBubble({ children }: { children: ReactNode }) { return <div className="ui-chat-bubble">{children}</div>; }
export function OnyxMessage({ children }: { children: ReactNode }) { return <div className="ui-onyx-message"><span className="ui-onyx-mark" aria-hidden="true" />{children}</div>; }
export function GeneratedBlock({ title, source, children }: { title: string; source: string; children: ReactNode }) { return <Card className="ui-generated-block"><h3>{title}</h3>{children}<small>Source: {source}</small></Card>; }
export function SoundWave({ active }: { active: boolean }) { return <span className="ui-sound-wave" data-active={active} aria-hidden="true">{[0, 1, 2, 3, 4].map((i) => <i key={i} />)}</span>; }
export function CommandDock({ value, onChange, onSubmit, disabled = false }: { value: string; onChange: (value: string) => void; onSubmit: () => void; disabled?: boolean }) { return <form className="ui-command-dock" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}><label className="ui-sr-only" htmlFor="ui-command-input">Ask Onyx</label><input id="ui-command-input" value={value} onChange={(event) => onChange(event.target.value)} placeholder="Ask Onyx…" /><Button tone="primary" type="submit" disabled={disabled || !value.trim()}>Send</Button></form>; }
