"use client";

import { useRef, useState } from "react";
import { FileText, LoaderCircle, Plus, Trash2, Upload, X } from "lucide-react";

export type KnowledgeDocument = {
  id: string;
  name: string;
  text: string;
  size: number;
};

type ProjectKnowledgeProps = {
  documents: KnowledgeDocument[];
  onChange: (documents: KnowledgeDocument[]) => void;
  onClose: () => void;
};

const MAX_DOCUMENT_CHARS = 30_000;

async function extractText(file: File): Promise<string> {
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";
    const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
    }
    return pages.join("\n\n").slice(0, MAX_DOCUMENT_CHARS);
  }

  return (await file.text()).slice(0, MAX_DOCUMENT_CHARS);
}

export default function ProjectKnowledge({ documents, onChange, onClose }: ProjectKnowledgeProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setLoading(true);
    setError("");
    try {
      const additions: KnowledgeDocument[] = [];
      for (const file of Array.from(files)) {
        const supported =
          file.type === "application/pdf" ||
          file.type.startsWith("text/") ||
          /\.(md|markdown|txt|csv|json|html|xml)$/i.test(file.name);
        if (!supported) {
          throw new Error(`${file.name} is not a supported PDF or text document.`);
        }
        additions.push({
          id: `${file.name}-${file.lastModified}-${crypto.randomUUID()}`,
          name: file.name,
          text: await extractText(file),
          size: file.size,
        });
      }
      onChange([...documents, ...additions]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read this file.");
    } finally {
      setLoading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="knowledge-scrim" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className="knowledge-drawer" aria-label="Project Knowledge">
        <div className="drawer-header">
          <div><span className="drawer-kicker">WORKSPACE CONTEXT</span><h2>Project Knowledge</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Close Project Knowledge"><X size={18} /></button>
        </div>
        <p className="drawer-description">Give Veltra the docs, brand voice, and product context it needs to make every answer feel on brief.</p>
        <div className="knowledge-files">
          {documents.map((document) => (
            <div className="knowledge-file" key={document.id}>
              <span className="file-icon"><FileText size={17} /></span>
              <div className="file-details"><strong>{document.name}</strong><span>{Math.max(1, Math.round(document.size / 1024))} KB · added to context</span></div>
              <button
                className="icon-button remove-file"
                onClick={() => onChange(documents.filter((item) => item.id !== document.id))}
                aria-label={`Remove ${document.name}`}
              ><Trash2 size={15} /></button>
            </div>
          ))}
          {documents.length === 0 && (
            <div className="empty-files"><div className="empty-file-icon"><FileText size={22} /></div><strong>Your project starts here</strong><span>Add a brief, brand guide, or product doc.</span></div>
          )}
        </div>
        {error && <p className="inline-error">{error}</p>}
        <div className="drawer-bottom">
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.txt,.md,.markdown,.csv,.json,.html,.xml,text/*,application/pdf"
            multiple
            hidden
            onChange={(event) => void handleFiles(event.target.files)}
          />
          <button className="upload-button" onClick={() => inputRef.current?.click()} disabled={loading}>
            {loading ? <LoaderCircle size={17} className="spin" /> : documents.length ? <Plus size={17} /> : <Upload size={17} />}
            {loading ? "Reading files…" : "Add documents"}
          </button>
          <p>PDF, TXT, Markdown, CSV, JSON · up to 30,000 characters per file</p>
        </div>
      </aside>
    </div>
  );
}
