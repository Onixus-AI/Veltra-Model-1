"use client";

import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Code2, Copy, Download, Eye, FileCode2, PencilLine, X } from "lucide-react";

export type Artifact = {
  kind: "html" | "react" | "markdown" | "mermaid";
  content: string;
  title: string;
};

type ArtifactCanvasProps = {
  artifact: Artifact;
  onChange: (artifact: Artifact) => void;
};

function escapeScript(source: string) {
  return source.replace(/<\/script/gi, "<\\/script");
}

function previewDocument(artifact: Artifact): string {
  if (artifact.kind === "html") {
    return artifact.content.toLowerCase().includes("<html")
      ? artifact.content
      : `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><script src="https://cdn.tailwindcss.com"></script></head><body>${artifact.content}</body></html>`;
  }

  const source = escapeScript(
    artifact.content
      .replace(/^\s*import\s+.*?;?\s*$/gm, "")
      .replace(/\bexport\s+default\s+/g, "")
      .replace(/\bexport\s+/g, ""),
  );
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><script src="https://cdn.tailwindcss.com"></script><script crossorigin src="https://unpkg.com/react@18/umd/react.development.js"></script><script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script><script src="https://unpkg.com/@babel/standalone/babel.min.js"></script><style>body{margin:0;padding:24px;font-family:Inter,system-ui,sans-serif}</style></head><body><div id="root"></div><script type="text/babel" data-presets="env,react,typescript">${source}\nconst Component = typeof App !== 'undefined' ? App : (typeof Demo !== 'undefined' ? Demo : (typeof defaultExport !== 'undefined' ? defaultExport : null));\nif (Component) ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Component));</script></body></html>`;
}

function MermaidPreview({ source }: { source: string }) {
  const [svg, setSvg] = useState("");
  const [error, setError] = useState("");
  const diagramId = useMemo(() => `veltra-diagram-${Math.random().toString(36).slice(2)}`, []);

  useEffect(() => {
    let cancelled = false;
    async function render() {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "neutral" });
        const result = await mermaid.render(diagramId, source);
        if (!cancelled) {
          setSvg(result.svg);
          setError("");
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not render this diagram.");
      }
    }
    void render();
    return () => { cancelled = true; };
  }, [diagramId, source]);

  if (error) return <div className="diagram-error">{error}</div>;
  return svg ? <div className="mermaid-result" dangerouslySetInnerHTML={{ __html: svg }} /> : <div className="diagram-loading">Rendering diagram…</div>;
}

export default function ArtifactCanvas({ artifact, onChange }: ArtifactCanvasProps) {
  const [showCode, setShowCode] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const fileExtension = artifact.kind === "markdown" ? "md" : artifact.kind === "mermaid" ? "mmd" : artifact.kind === "react" ? "jsx" : "html";

  async function copyCode() {
    await navigator.clipboard.writeText(artifact.content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  function exportArtifact() {
    const blob = new Blob([artifact.content], { type: artifact.kind === "markdown" ? "text/markdown" : "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${artifact.title.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "veltra-artifact"}.${fileExtension}`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="canvas-panel">
      <div className="canvas-topbar">
        <div className="canvas-file">
          <span className="canvas-file-icon"><FileCode2 size={16} /></span>
          <div><span className="canvas-file-name">{artifact.title}</span><span className="canvas-file-type">{artifact.kind === "react" ? "REACT COMPONENT" : artifact.kind.toUpperCase()}</span></div>
          <span className="live-indicator"><i /> LIVE</span>
        </div>
        <div className="canvas-actions">
          <button className="canvas-action" onClick={() => void copyCode()} title="Copy artifact source">
            {copied ? <Check size={14} /> : <Copy size={14} />}<span>{copied ? "Copied" : "Copy Code"}</span>
          </button>
          <span className="action-divider" />
          <button className={`canvas-action ${showCode ? "active" : ""}`} onClick={() => setShowCode(!showCode)} title="Toggle source and preview">
            {showCode ? <Eye size={14} /> : <Code2 size={14} />}<span>{showCode ? "Preview" : "Code"}</span>
          </button>
          <button className="canvas-action export-action" onClick={exportArtifact}><Download size={14} /><span>Export</span></button>
        </div>
      </div>
      <div className="canvas-workarea">
        {showCode || (artifact.kind === "markdown" && editing) ? (
          <div className="code-view">
            <div className="editor-label"><span>{artifact.kind === "markdown" && editing ? "EDIT MARKDOWN" : "SOURCE"}</span>
              {artifact.kind === "markdown" && <button onClick={() => setEditing(!editing)}>{editing ? <><Eye size={13} /> Preview</> : <><PencilLine size={13} /> Edit</>}</button>}
            </div>
            {artifact.kind === "markdown" && editing
              ? <textarea className="artifact-editor" value={artifact.content} onChange={(event) => onChange({ ...artifact, content: event.target.value })} aria-label="Edit markdown document" />
              : <pre className="artifact-code"><code>{artifact.content}</code></pre>}
          </div>
        ) : (
          <div className={`artifact-preview ${artifact.kind === "markdown" ? "markdown-preview" : ""}`}>
            {artifact.kind === "markdown" ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{artifact.content}</ReactMarkdown>
              : artifact.kind === "mermaid" ? <MermaidPreview source={artifact.content} />
                : <iframe title={`${artifact.title} preview`} sandbox="allow-scripts" srcDoc={previewDocument(artifact)} />}
          </div>
        )}
      </div>
      <div className="canvas-status"><span><i /> All changes saved</span><span>Veltra Canvas <b>·</b> {artifact.kind.toUpperCase()}</span></div>
    </section>
  );
}
