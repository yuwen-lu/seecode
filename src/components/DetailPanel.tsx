"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Copy, Check, ChevronRight, ChevronLeft } from "lucide-react";
import type { ArchModule, PanelSelection, NodeCategory } from "@/types/graph";
import { CATEGORY_COLORS, CATEGORY_LABELS } from "@/types/graph";

type PanelView =
  | { level: "component"; category: NodeCategory; label: string; members: ArchModule[] }
  | { level: "module"; module: ArchModule }
  | { level: "file"; module: ArchModule; file: string };

export type PanelDepth = "component" | "module" | "file";

interface DetailPanelProps {
  selection: PanelSelection;
  sourceSnippets?: Record<string, string>;
  onClose: () => void;
  onViewChange: (depth: PanelDepth, moduleId: string | null) => void;
}

export function DetailPanel({ selection, sourceSnippets, onClose, onViewChange }: DetailPanelProps) {
  const [width, setWidth] = useState(400);
  const isResizing = useRef(false);

  // Internal navigation stack
  const [viewStack, setViewStack] = useState<PanelView[]>(() => selectionToView(selection));

  // Sync when external selection changes
  useEffect(() => {
    setViewStack(selectionToView(selection));
  }, [selection]);

  const currentView = viewStack[viewStack.length - 1];

  // Notify parent whenever the current view changes
  useEffect(() => {
    const moduleId = currentView.level === "component" ? null
      : currentView.level === "module" ? currentView.module.id
      : currentView.module.id;
    onViewChange(currentView.level, moduleId);
  }, [currentView]); // eslint-disable-line react-hooks/exhaustive-deps

  const pushView = useCallback((view: PanelView) => {
    setViewStack((prev) => [...prev, view]);
  }, []);

  const goBack = useCallback(() => {
    if (viewStack.length <= 1) return;
    setViewStack(viewStack.slice(0, -1));
  }, [viewStack]);

  const canGoBack = viewStack.length > 1;

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

      {/* Header */}
      <PanelHeader
        view={currentView}
        canGoBack={canGoBack}
        onBack={goBack}
        onClose={onClose}
      />

      {/* Body */}
      {currentView.level === "component" && (
        <ComponentBody view={currentView} onSelectModule={(mod) => pushView({ level: "module", module: mod })} />
      )}
      {currentView.level === "module" && (
        <ModuleBody
          module={currentView.module}
          sourceSnippets={sourceSnippets}
          onSelectFile={(file) => pushView({ level: "file", module: currentView.module, file })}
        />
      )}
      {currentView.level === "file" && (
        <FileBody
          module={currentView.module}
          file={currentView.file}
          sourceSnippets={sourceSnippets}
        />
      )}
    </div>
  );
}

function selectionToView(sel: PanelSelection): PanelView[] {
  if (sel.kind === "component") {
    return [{ level: "component", category: sel.category, label: sel.label, members: sel.members }];
  }
  return [{ level: "module", module: sel.module }];
}

/* ─── Header ─── */

function PanelHeader({
  view,
  canGoBack,
  onBack,
  onClose,
}: {
  view: PanelView;
  canGoBack: boolean;
  onBack: () => void;
  onClose: () => void;
}) {
  const category = view.level === "component" ? view.category : view.module.category;
  const colors = CATEGORY_COLORS[category];

  let title: string;
  if (view.level === "component") title = view.label;
  else if (view.level === "module") title = view.module.name;
  else title = view.file.split("/").pop() ?? view.file;

  return (
    <div className="flex items-center justify-between px-3 py-2.5 border-b border-border shrink-0 gap-2">
      <div className="flex items-center gap-1.5 min-w-0">
        {canGoBack && (
          <button
            onClick={onBack}
            className="shrink-0 cursor-pointer text-text-tertiary hover:text-foreground p-0.5 -ml-0.5"
          >
            <ChevronLeft size={16} />
          </button>
        )}
        <h2 className="text-sm font-semibold text-foreground truncate">
          {title}
        </h2>
        <span
          className="text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0"
          style={{
            background: colors.border + "22",
            color: colors.border,
            border: `1px solid ${colors.border}44`,
          }}
        >
          {view.level === "file" ? "File" : CATEGORY_LABELS[category]}
        </span>
      </div>
      <button
        onClick={onClose}
        className="text-text-secondary hover:text-foreground text-lg px-1 cursor-pointer shrink-0"
      >
        &times;
      </button>
    </div>
  );
}

/* ─── Component-level body ─── */

function ComponentBody({
  view,
  onSelectModule,
}: {
  view: Extract<PanelView, { level: "component" }>;
  onSelectModule: (mod: ArchModule) => void;
}) {
  const totalLines = view.members.reduce((sum, m) => sum + (m.lineCount ?? 0), 0);
  const totalFiles = view.members.reduce((sum, m) => sum + m.files.length, 0);

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3 text-[13px] leading-relaxed">
      <div className="text-[11px] text-text-tertiary mb-3">
        {view.members.length} module{view.members.length !== 1 ? "s" : ""}
        {totalFiles > 0 ? ` · ${totalFiles} files` : ""}
        {totalLines > 0 ? ` · ${totalLines.toLocaleString()} lines` : ""}
      </div>

      <SectionTitle>Modules</SectionTitle>
      <div className="space-y-1.5">
        {view.members.map((mod) => (
          <button
            key={mod.id}
            onClick={() => onSelectModule(mod)}
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
            {mod.keyTypes.length > 0 && (
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
            )}
            <div className="text-[10px] text-text-tertiary mt-1">
              {mod.files.length} file{mod.files.length !== 1 ? "s" : ""}
              {mod.lineCount ? ` · ${mod.lineCount.toLocaleString()} lines` : ""}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ─── Module-level body ─── */

function ModuleBody({
  module: mod,
  sourceSnippets,
  onSelectFile,
}: {
  module: ArchModule;
  sourceSnippets?: Record<string, string>;
  onSelectFile: (file: string) => void;
}) {
  return (
    <div className="flex-1 overflow-y-auto px-4 py-3 text-[13px] leading-relaxed space-y-4">
      {/* Responsibility */}
      <p className="text-text-secondary">{mod.responsibility}</p>

      {/* Files */}
      {mod.files.length > 0 && (
        <div>
          <SectionTitle>Files</SectionTitle>
          <div className="space-y-0.5">
            {mod.files.map((f) => {
              const hasSource = !!sourceSnippets?.[f];
              return (
                <button
                  key={f}
                  onClick={() => hasSource && onSelectFile(f)}
                  className={`flex items-center justify-between gap-2 text-[11px] font-mono w-full px-1.5 py-1 rounded transition-colors ${
                    hasSource
                      ? "text-text-tertiary hover:text-text-secondary hover:bg-surface-2 cursor-pointer group"
                      : "text-text-tertiary"
                  }`}
                >
                  <span className="truncate">{f}</span>
                  {hasSource && (
                    <ChevronRight size={12} className="shrink-0 text-text-tertiary group-hover:text-accent opacity-0 group-hover:opacity-100 transition-opacity" />
                  )}
                </button>
              );
            })}
          </div>
          {mod.lineCount != null && mod.lineCount > 0 && (
            <p className="text-[11px] text-text-tertiary mt-1">
              {mod.lineCount.toLocaleString()} lines total
            </p>
          )}
        </div>
      )}

      {/* Key Types */}
      {mod.keyTypes.length > 0 && (
        <div>
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

      {/* Key Methods */}
      {mod.keyMethods.length > 0 && (
        <div>
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
    </div>
  );
}

/* ─── File-level body ─── */

function FileBody({
  module: mod,
  file,
  sourceSnippets,
}: {
  module: ArchModule;
  file: string;
  sourceSnippets?: Record<string, string>;
}) {
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const sourceCode = sourceSnippets?.[file];

  useEffect(() => {
    setHighlightedHtml(null);
    if (!sourceCode) return;

    let cancelled = false;
    (async () => {
      try {
        const { codeToHtml } = await import("shiki");
        const lang = inferShikiLang(file);
        const html = await codeToHtml(sourceCode, { lang, theme: "vitesse-dark" });
        if (!cancelled) setHighlightedHtml(html);
      } catch {
        if (!cancelled) setHighlightedHtml(null);
      }
    })();
    return () => { cancelled = true; };
  }, [file, sourceCode]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* File path bar */}
      <div className="bg-surface-2 px-3 py-1.5 text-[10px] font-mono text-text-tertiary border-b border-border shrink-0 flex items-center gap-1.5">
        <span className="truncate">{file}</span>
        <button
          onClick={() => {
            navigator.clipboard.writeText(file);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          title="Copy file path"
          className="shrink-0 cursor-pointer text-text-tertiary hover:text-text-secondary"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
        </button>
      </div>

      {/* Code */}
      {sourceCode ? (
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
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-[11px] text-text-tertiary italic">
            Source not available
          </p>
        </div>
      )}
    </div>
  );
}

/* ─── Shared ─── */

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-semibold uppercase tracking-wider text-accent mb-1.5 shrink-0">
      {children}
    </h3>
  );
}

function inferShikiLang(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx",
    py: "python", go: "go", rs: "rust", swift: "swift",
    java: "java", kt: "kotlin", rb: "ruby", php: "php",
    cs: "csharp", cpp: "cpp", c: "c", h: "c", hpp: "cpp",
  };
  return map[ext] ?? "text";
}
