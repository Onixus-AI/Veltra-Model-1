"use client";

import { useState } from "react";
import Link from "next/link";
import { AgentCard, Button, Card, ChatBubble, CommandDock, ConfirmDialog, DecisionRow, Drawer, EmptyState, GeneratedBlock, MonoLabel, OnyxMessage, PageHeader, Skeleton, SoundWave, StatusBadge, Table, Tabs, Toast } from "@/components/ui";
import "@/styles/design-system-page.css";

export default function DesignSystemPage() {
  const [tab, setTab] = useState("overview");
  const [confirm, setConfirm] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [notice, setNotice] = useState("");
  const [command, setCommand] = useState("");
  return <main className="ui-gallery">
    <nav aria-label="Design system breadcrumb"><Link href="/design">← Website editor</Link></nav>
    <PageHeader title="Onixus design system" description="Flat surfaces, clear decisions, and one shared visual language for Workspace and Onyx Mail." action={{ label: "Open panel", onClick: () => setDrawer(true) }} />
    <section className="ui-gallery-section"><MonoLabel>Colour and type</MonoLabel><div className="ui-gallery-swatches">
      {[["Canvas", "canvas"], ["Surface", "surface"], ["Raised", "raised"], ["Card", "card"], ["Violet", "accent"], ["Text", "text"]].map(([name, id]) => <div key={id}><span className={`ui-gallery-swatch ui-gallery-swatch-${id}`} /><strong>{name}</strong></div>)}
    </div><p className="ui-gallery-display">One clear decision at a time.</p><p className="ui-gallery-body">Readable content uses Inter. Small operational labels use JetBrains Mono.</p></section>
    <section className="ui-gallery-section"><MonoLabel>Actions and states</MonoLabel><div className="ui-gallery-row"><Button tone="primary" onClick={() => setConfirm(true)}>Review decision</Button><Button tone="secondary" onClick={() => setNotice("Secondary action selected")}>Secondary action</Button><Button tone="quiet" onClick={() => setNotice("Quiet action selected")}>Quiet action</Button><Button tone="danger" onClick={() => setConfirm(true)}>Remove</Button></div><div className="ui-gallery-row"><StatusBadge state="connected" detail="Account linked" /><StatusBadge state="attention" /><StatusBadge state="off" /></div><Tabs label="Example sections" items={[{ id: "overview", label: "Overview" }, { id: "workflow", label: "Workflow" }, { id: "calendar", label: "Calendar" }]} selected={tab} onSelect={setTab} /><p className="ui-gallery-caption">Selected: {tab}</p></section>
    <section className="ui-gallery-section"><MonoLabel>Decisions and agents · sample data</MonoLabel><DecisionRow source="Mail agent" time="Example · 12 min ago" title="A rate request needs your number." detail="The draft is ready for review." action={{ label: "Review", onClick: () => setConfirm(true) }} /><div className="ui-gallery-agents"><AgentCard name="Mail" state="working" detail="Example status, not live activity" /><AgentCard name="Signal" state="idle" detail="Example status, not live activity" /></div></section>
    <section className="ui-gallery-section"><MonoLabel>Content, feedback and empty states</MonoLabel><div className="ui-gallery-grid"><Card><h2>Card</h2><p>For related content that needs a contained surface.</p></Card><GeneratedBlock title="Generated answer" source="Example only · no live data"><p>Structured answers show the source and time range.</p></GeneratedBlock></div><EmptyState title="Nothing needs you" detail="A clear next action appears here when one is available." action={{ label: "See workflow", onClick: () => setTab("workflow") }} /><Table headers={["Item", "State"]}><tr><td>Sample job</td><td>In review</td></tr></Table><div className="ui-gallery-skeleton"><Skeleton /></div></section>
    <section className="ui-gallery-section"><MonoLabel>Onyx conversation</MonoLabel><div className="ui-gallery-conversation"><ChatBubble>How did this week go?</ChatBubble><OnyxMessage><div><SoundWave active /><p>This is a sample answer. Live results will cite their records.</p></div></OnyxMessage><CommandDock value={command} onChange={setCommand} onSubmit={() => { setNotice("Sample command only"); setCommand(""); }} /></div></section>
    {notice && <Toast message={notice} />}
    <ConfirmDialog open={confirm} title="Review this action" description="This is a design example. No business record will change." confirmLabel="Close example" onConfirm={() => setConfirm(false)} onClose={() => setConfirm(false)} />
    <Drawer open={drawer} title="Example panel" onClose={() => setDrawer(false)}><p>Drawers hold secondary details without covering the main decision list.</p></Drawer>
  </main>;
}
