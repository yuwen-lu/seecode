"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Copy, Check, ChevronRight } from "lucide-react";
import type { ArchModule, PanelSelection } from "@/types/graph";
import { CATEGORY_COLORS, CATEGORY_LABELS } from "@/types/graph";

interface DetailPanelProps {
  selection: PanelSelection;
  sourceSnippets?: Record<string, string>;
  onClose: () => void;
  onDrillToModule: (mod: ArchModule) => void;
}

export function DetailPanel({ selection, sourceSnippets, onClose, onDrillToModule }: DetailPanelProps) {
  const [width, setWidth] = useState(400);
  const isResizing = useRef(false);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    const startX = e.clientX;
    const startWidth = width;

    function onMouseMove(e: MouseEvent) {
      if (!isResizing.current) return;
      const delta = startX - e.clientX;
      setWidth(Math.max(300, Math.min(700, startWidth + delta)));
    }

    function onMouseUp() {
      isResizing.current = false;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [width]);

  return (
    <div
      className="shrink-0 bg-surface-1 border-l border-border flex flex-col h-full overflow-hidden relative"
      style={{ width }}
    >
      {/* Resize handle */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-accent/30 active:bg-accent/50 z-10"
        onMouseDown={onMouseDown}
      />

      {selection.kind === "component" ? (
        <ComponentView
          selection={selection}
          onClose={onClose}
          onDrillToModule={onDrillToModule}
        />
      ) : (
        <ModuleView
          module={selection.module}
          sourceSnippets={sourceSnippets}
          onClose={onClose}
        />
      )}
    </div>
  );
}

/* ─── Component-level view ─── */

function ComponentView({
  selection,
  onClose,
  onDrillToModule,
}: {
  selection: Extract<PanelSelection, { kind: "component" }>;
  onClose: () => void;
  onDrillToModule: (mod: ArchModule) => void;
}) {
  const colors = CATEGORY_COLORS[selection.category];
  const totalLines = selection.members.reduce((sum, m) => sum + (m.lineCount ?? 0), 0);
  const totalFiles = selection.members.reduce((sum, m) => sum + m.files.length, 0);

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="text-sm font-semibold text-foreground truncate">
            {selection.label}
          </h2>
          <span
            className="text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0"
            style={{
              background: colors.border + "22",
              color: colors.border,
              border: `1px solid ${colors.border}44`,
            }}
          >
            {CATEGORY_LABELS[selection.category]}
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-text-secondary hover:text-foreground text-lg px-1 cursor-pointer"
        >
          &times;
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-3 text-[13px] leading-relaxed">
        {/* Stats */}
        <div className="text-[11px] text-text-tertiary mb-3">
          {selection.members.length} module{selection.members.length !== 1 ? "s" : ""}
          {totalFiles > 0 ? ` · ${totalFiles} files` : ""}
          {totalLines > 0 ? ` · ${totalLines.toLocaleString()} lines` : ""}
        </div>

        {/* Module list */}
        <SectionTitle>Modules</SectionTitle>
        <div className="space-y-1.5">
          {selection.members.map((mod) => (
            <button
              key={mod.id}
              onClick={() => onDrillToModule(mod)}
              className="w-full text-left rounded-lg px-3 py-2.5 cursor-pointer transition-colors hover:bg-surface-2 group border border-border/50 hover:border-border"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-foreground truncate">
                  {mod.name}
                </span>
                <ChevronRight size={14} className="shrink-0 text-text-tertiary group-hover:text-accent transition-colors" />
              </div>
              <p className="text-[11px] text-text-secondary mt-0.5 line-clamp-2">
                {mod.responsibility}
              </p>
              <div className="flex flex-wrap gap-1 mt-1.5">
                {mod.keyTypes.slice(0, 3).map((t) => (
                  <span
                    key={t}
                    className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-surface-2 text-accent"
                  >
                    {t}
                  </span>
                ))}
                {mod.keyTypes.length > 3 && (
                  <span className="text-[9px] text-text-tertiary">
                    +{mod.keyTypes.length - 3}
                  </span>
                )}
              </div>
              <div className="text-[10px] text-text-tertiary mt-1">
                {mod.files.length} file{mod.files.length !== 1 ? "s" : ""}
                {mod.lineCount ? ` · ${mod.lineCount.toLocaleString()} lines` : ""}
              </div>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

/* ─── Module-level view ─── */

function ModuleView({
  module: mod,
  sourceSnippets,
  onClose,
}: {
  module: ArchModule;
  sourceSnippets?: Record<string, string>;
  onClose: () => void;
}) {
  const colors = CATEGORY_COLORS[mod.category];
  const [activeFile, setActiveFile] = useState<string | null>(
    mod.files.length > 0 ? mod.files[0] : null
  );
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setActiveFile(mod.files.length > 0 ? mod.files[0] : null);
    setHighlightedHtml(null);
  }, [mod.id]);

  useEffect(() => {
    if (!activeFile || !sourceSnippets?.[activeFile]) {
      setHighlightedHtml(null);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const { codeToHtml } = await import("shiki");
        const lang = inferShikiLang(activeFile);
        const html = await codeToHtml(sourceSnippets[activeFile], {
          lang,
          theme: "vitesse-dark",
        });
        if (!cancelled) setHighlightedHtml(html);
      } catch {
        if (!cancelled) setHighlightedHtml(null);
      }
    })();
    return () => { cancelled = true; };
  }, [activeFile, sourceSnippets]);

  const sourceCode = activeFile ? sourceSnippets?.[activeFile] : null;

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="text-sm font-semibold text-foreground truncate">
            {mod.name}
          </h2>
          <span
            className="text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0"
            style={{
              background: colors.border + "22",
              color: colors.border,
              border: `1px solid ${colors.border}44`,
            }}
          >
            {CATEGORY_LABELS[mod.category]}
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-text-secondary hover:text-foreground text-lg px-1 cursor-pointer"
        >
          &times;
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 flex flex-col overflow-hidden px-4 py-3 text-[13px] leading-relaxed">
        <p className="text-text-secondary mb-3 shrink-0">{mod.responsibility}</p>

        <SectionTitle>Files</SectionTitle>
        <div className="space-y-0.5 mb-1 shrink-0">
          {mod.files.map((f) => (
            <button
              key={f}
              onClick={() => setActiveFile(f)}
              className={`block text-left text-[11px] font-mono w-full px-1.5 py-0.5 rounded transition-colors cursor-pointer ${
                activeFile === f
                  ? "bg-accent/15 text-accent"
                  : "text-text-tertiary hover:text-text-secondary hover:bg-surface-2"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        {mod.lineCount && (
          <p className="text-[11px] text-text-tertiary shrink-0">
            {mod.lineCount.toLocaleString()} lines total
          </p>
        )}

        {mod.keyTypes.length > 0 && (
          <div className="shrink-0">
            <SectionTitle>Key Types</SectionTitle>
            <div className="flex flex-wrap gap-1.5">
              {mod.keyTypes.map((t) => (
                <span
                  key={t}
                  className="text-xs font-mono px-2 py-0.5 rounded bg-surface-2 text-accent"
                >
                  {t}
                </span>
              ))}
            </div>
          </div>
        )}

        {mod.keyMethods.length > 0 && (
          <div className="shrink-0">
            <SectionTitle>Key Methods</SectionTitle>
            <ul className="space-y-0.5">
              {mod.keyMethods.map((m) => (
                <li key={m} className="text-xs font-mono text-text-secondary">
                  {m}
                </li>
              ))}
            </ul>
          </div>
        )}

        <SectionTitle>Source Preview</SectionTitle>
        {sourceCode ? (
          <div className="rounded-lg overflow-hidden border border-border flex flex-col flex-1 min-h-0">
            <div className="bg-surface-2 px-3 py-1.5 text-[10px] font-mono text-text-tertiary border-b border-border shrink-0 flex items-center gap-1.5">
              <span className="truncate">{activeFile}</span>
              <button
                onClick={() => {
                  if (activeFile) {
                    navigator.clipboard.writeText(activeFile);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }
                }}
                title="Copy file path"
                className="shrink-0 cursor-pointer text-text-tertiary hover:text-text-secondary"
              >
                {copied ? <Check size={12} /> : <Copy size={12} />}
              </button>
            </div>
            <div className="flex-1 overflow-auto hide-scrollbar text-[11px] leading-relaxed">
              {highlightedHtml ? (
                <div
                  className="shiki-container"
                  dangerouslySetInnerHTML={{ __html: highlightedHtml }}
                />
              ) : (
                <pre className="p-3 text-text-secondary font-mono whitespace-pre">
                  {sourceCode}
                </pre>
              )}
            </div>
          </div>
        ) : (
          <p className="text-[11px] text-text-tertiary italic">
            {mod.files.length === 0
              ? "No files associated with this module"
              : "Source preview not available"}
          </p>
        )}
      </div>
    </>
  );
}

/* ─── Shared ─── */

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-semibold uppercase tracking-wider text-accent mt-4 mb-1.5 first:mt-0 shrink-0">
      {children}
    </h3>
  );
}

function inferShikiLang(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    py: "python",
    go: "go",
    rs: "rust",
    swift: "swift",
    java: "java",
    kt: "kotlin",
    rb: "ruby",
    php: "php",
    cs: "csharp",
    cpp: "cpp",
    c: "c",
    h: "c",
    hpp: "cpp",
  };
  return map[ext] ?? "text";
}
