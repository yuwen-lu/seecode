"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { Copy, Check, ChevronRight, ChevronLeft, Maximize2, X } from "lucide-react";
import { useTheme } from "next-themes";
import type { ArchModule, PanelSelection, NodeCategory } from "@/types/graph";
import { getCategoryColors, CATEGORY_LABELS, githubRawUrl } from "@/types/graph";

type PanelView =
  | { level: "component"; category: NodeCategory; label: string; members: ArchModule[] }
  | { level: "module"; module: ArchModule }
  | { level: "file"; module: ArchModule; file: string };

export type PanelDepth = "component" | "module" | "file";

interface DetailPanelProps {
  selection: PanelSelection;
  repoUrl: string;
  commitSha: string;
  onClose: () => void;
  onViewChange: (depth: PanelDepth, moduleId: string | null, file?: string) => void;
  initialFile?: string | null;
}

export function DetailPanel({ selection, repoUrl, commitSha, onClose, onViewChange, initialFile }: DetailPanelProps) {
  const [width, setWidth] = useState(400);
  const isResizing = useRef(false);

  // Internal navigation stack
  const [viewStack, setViewStack] = useState<PanelView[]>(() => selectionToView(selection));

  // Sync when external selection changes
  useEffect(() => {
    setViewStack(selectionToView(selection));
  }, [selection]);

  // Navigate to file when initialFile is set (from chat panel)
  useEffect(() => {
    if (!initialFile) return;
    if (selection.kind === "module") {
      const mod = selection.module;
      if (mod.files.includes(initialFile)) {
        setViewStack((prev) => [...prev, { level: "file", module: mod, file: initialFile }]);
      }
    }
  }, [initialFile]); // eslint-disable-line react-hooks/exhaustive-deps

  const currentView = viewStack[viewStack.length - 1];

  // Notify parent whenever the current view changes
  useEffect(() => {
    const moduleId = currentView.level === "component" ? null
      : currentView.module.id;
    const file = currentView.level === "file" ? currentView.file : undefined;
    onViewChange(currentView.level, moduleId, file);
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
      const delta = e.clientX - startX;
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
      className="absolute left-0 top-0 bottom-0 z-20 bg-surface-1/95 backdrop-blur-sm border-r border-border flex flex-col overflow-hidden animate-slide-in-left"
      style={{ width }}
    >
      {/* Resize handle */}
      <div
        className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-accent/30 active:bg-accent/50 z-10"
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
          repoUrl={repoUrl}
          commitSha={commitSha}
          onSelectFile={(file) => pushView({ level: "file", module: currentView.module, file })}
        />
      )}
      {currentView.level === "file" && (
        <FileBody
          file={currentView.file}
          repoUrl={repoUrl}
          commitSha={commitSha}
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
  const colors = getCategoryColors()[category];

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
          className="text-xs px-1.5 py-0.5 rounded font-medium shrink-0"
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
        className="text-text-tertiary hover:text-foreground p-1 rounded hover:bg-surface-2 transition-colors cursor-pointer shrink-0"
      >
        <X size={14} />
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
  const { theme } = useTheme();
  const colors = getCategoryColors(theme === "dark")[view.category];
  const totalLines = view.members.reduce((sum, m) => sum + (m.lineCount ?? 0), 0);
  const totalFiles = view.members.reduce((sum, m) => sum + m.files.length, 0);

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3 text-sm leading-relaxed">
      <div className="text-[13px] text-text-tertiary mb-3">
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
              <span className="text-sm font-semibold text-foreground truncate">
                {mod.name}
              </span>
              <ChevronRight size={14} className="shrink-0 text-text-tertiary group-hover:text-accent transition-colors" />
            </div>
            <p className="text-[13px] text-foreground/80 mt-0.5 line-clamp-2">
              {mod.responsibility}
            </p>
            {mod.keyTypes.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {mod.keyTypes.slice(0, 3).map((t) => (
                  <span
                    key={t}
                    className="text-[13px] font-mono px-1.5 py-0.5 rounded"
                    style={{
                      color: colors.border,
                      background: colors.border + "18",
                    }}
                  >
                    {t}
                  </span>
                ))}
                {mod.keyTypes.length > 3 && (
                  <span className="text-[13px] text-text-tertiary">
                    +{mod.keyTypes.length - 3}
                  </span>
                )}
              </div>
            )}
            <div className="text-xs text-text-tertiary mt-1">
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
  repoUrl,
  commitSha,
  onSelectFile,
}: {
  module: ArchModule;
  repoUrl: string;
  commitSha: string;
  onSelectFile: (file: string) => void;
}) {
  const { theme } = useTheme();
  const shikiTheme = theme === "light" ? "github-light-default" : "github-dark-default";
  const colors = getCategoryColors(theme === "dark")[mod.category];
  const [copiedFile, setCopiedFile] = useState<string | null>(null);
  const [activeFile, setActiveFile] = useState<string | null>(
    mod.files.length > 0 ? mod.files[0] : null
  );
  const [sourceCode, setSourceCode] = useState<string | null>(null);
  const [loadingSource, setLoadingSource] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  // Reset active file when module changes
  useEffect(() => {
    setActiveFile(mod.files.length > 0 ? mod.files[0] : null);
  }, [mod.id]);

  // Fetch source for active file
  useEffect(() => {
    setSourceCode(null);
    setHighlightedHtml(null);
    setSourceError(null);

    if (!activeFile) return;

    const rawUrl = githubRawUrl(repoUrl, commitSha, activeFile);
    if (!rawUrl) {
      setSourceError("Cannot resolve file URL");
      return;
    }

    setLoadingSource(true);
    let cancelled = false;

    fetch(rawUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then((text) => {
        if (!cancelled) {
          setSourceCode(text);
          setLoadingSource(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setSourceError(`Failed to load: ${err.message}`);
          setLoadingSource(false);
        }
      });

    return () => { cancelled = true; };
  }, [activeFile, repoUrl, commitSha]);

  // Highlight after fetch
  useEffect(() => {
    if (!sourceCode || !activeFile) return;
    let cancelled = false;
    (async () => {
      try {
        const { codeToHtml } = await import("shiki");
        const lang = inferShikiLang(activeFile);
        const html = await codeToHtml(sourceCode, { lang, theme: shikiTheme });
        if (!cancelled) setHighlightedHtml(html);
      } catch {
        if (!cancelled) setHighlightedHtml(null);
      }
    })();
    return () => { cancelled = true; };
  }, [sourceCode, activeFile, shikiTheme]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden px-4 py-3 text-sm leading-relaxed">
      {/* Responsibility */}
      <p className="text-text-secondary mb-4 shrink-0">{mod.responsibility}</p>

      {/* Files */}
      {mod.files.length > 0 && (
        <div className="shrink-0 mb-4">
          <SectionTitle>Files</SectionTitle>
          <div className="space-y-0.5">
            {mod.files.map((f) => (
              <div
                key={f}
                className={`flex items-center justify-between gap-2 text-[13px] font-mono w-full px-1.5 py-1 rounded-lg transition-colors group ${
                  activeFile === f
                    ? "bg-surface-2"
                    : "hover:bg-surface-2"
                }`}
                style={{ color: colors.border, opacity: activeFile === f ? 1 : 0.7 }}
              >
                <button
                  onClick={() => setActiveFile(f)}
                  onDoubleClick={() => onSelectFile(f)}
                  className="truncate cursor-pointer text-left min-w-0"
                >
                  {f}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    navigator.clipboard.writeText(f);
                    setCopiedFile(f);
                    setTimeout(() => setCopiedFile(null), 1500);
                  }}
                  title="Copy file path"
                  className="shrink-0 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ color: colors.border }}
                >
                  {copiedFile === f ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
            ))}
          </div>
          {mod.lineCount != null && mod.lineCount > 0 && (
            <p className="text-[13px] text-text-tertiary mt-1">
              {mod.lineCount.toLocaleString()} lines total
            </p>
          )}
        </div>
      )}

      {/* Key Types */}
      {mod.keyTypes.length > 0 && (
        <div className="shrink-0 mb-4">
          <SectionTitle>Key Types</SectionTitle>
          <div className="flex flex-wrap gap-1.5">
            {mod.keyTypes.map((t) => (
              <span
                key={t}
                className="text-xs font-mono px-2 py-0.5 rounded"
                style={{
                  color: colors.border,
                  background: colors.border + "18",
                }}
              >
                {t}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Key Methods */}
      {mod.keyMethods.length > 0 && (
        <div className="shrink-0 mb-4">
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

      {/* Source Preview — grows to fill remaining space */}
      <SectionTitle>Source Preview</SectionTitle>
      <div className="rounded-lg overflow-hidden border border-border flex flex-col flex-1 min-h-0">
        {activeFile && (
          <div className="bg-surface-2 px-3 py-1.5 text-xs font-mono text-text-tertiary border-b border-border shrink-0 flex items-center gap-1.5">
            <span className="truncate flex-1">{activeFile}</span>
            {(sourceCode || highlightedHtml) && (
              <button
                onClick={() => setLightboxOpen(true)}
                title="Expand preview"
                className="shrink-0 cursor-pointer text-text-tertiary hover:text-text-secondary"
              >
                <Maximize2 size={14} />
              </button>
            )}
          </div>
        )}
        <div className="flex-1 overflow-auto subtle-scrollbar text-sm leading-relaxed">
          {loadingSource ? (
            <div className="p-3 text-text-tertiary text-[13px]">Loading source...</div>
          ) : sourceError ? (
            <div className="p-3 text-text-tertiary text-[13px] italic">{sourceError}</div>
          ) : highlightedHtml ? (
            <div
              className="shiki-container"
              dangerouslySetInnerHTML={{ __html: highlightedHtml }}
            />
          ) : sourceCode ? (
            <pre className="p-3 text-text-secondary font-mono whitespace-pre">
              {sourceCode}
            </pre>
          ) : (
            <div className="p-3 text-text-tertiary text-[13px] italic">
              {mod.files.length === 0 ? "No files associated with this module" : "Select a file to preview"}
            </div>
          )}
        </div>
      </div>

      {/* Lightbox */}
      {lightboxOpen && activeFile && (
        <CodeLightbox
          file={activeFile}
          sourceCode={sourceCode}
          highlightedHtml={highlightedHtml}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </div>
  );
}

/* ─── File-level body ─── */

function FileBody({
  file,
  repoUrl,
  commitSha,
}: {
  file: string;
  repoUrl: string;
  commitSha: string;
}) {
  const { theme } = useTheme();
  const shikiTheme = theme === "light" ? "github-light-default" : "github-dark-default";
  const [sourceCode, setSourceCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Fetch source from GitHub raw
  useEffect(() => {
    setSourceCode(null);
    setHighlightedHtml(null);
    setLoading(true);
    setError(null);

    const rawUrl = githubRawUrl(repoUrl, commitSha, file);
    if (!rawUrl) {
      setError("Cannot resolve file URL");
      setLoading(false);
      return;
    }

    let cancelled = false;
    fetch(rawUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        return res.text();
      })
      .then((text) => {
        if (!cancelled) {
          setSourceCode(text);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(`Failed to fetch: ${err.message}`);
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [file, repoUrl, commitSha]);

  // Highlight with shiki after source loads
  useEffect(() => {
    if (!sourceCode) return;
    let cancelled = false;
    (async () => {
      try {
        const { codeToHtml } = await import("shiki");
        const lang = inferShikiLang(file);
        const html = await codeToHtml(sourceCode, { lang, theme: shikiTheme });
        if (!cancelled) setHighlightedHtml(html);
      } catch {
        if (!cancelled) setHighlightedHtml(null);
      }
    })();
    return () => { cancelled = true; };
  }, [sourceCode, file, shikiTheme]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* File path bar */}
      <div className="bg-surface-2 px-3 py-1.5 text-xs font-mono text-text-tertiary border-b border-border shrink-0 flex items-center gap-1.5">
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
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      </div>

      {/* Code */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-[13px] text-text-tertiary">Loading source...</p>
        </div>
      ) : error ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-[13px] text-text-tertiary italic">{error}</p>
        </div>
      ) : sourceCode ? (
        <div className="flex-1 overflow-auto subtle-scrollbar text-sm leading-relaxed">
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
      ) : null}
    </div>
  );
}

/* ─── Code Lightbox ─── */

function CodeLightbox({
  file,
  sourceCode,
  highlightedHtml,
  onClose,
}: {
  file: string;
  sourceCode: string | null;
  highlightedHtml: string | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70" />

      {/* Modal */}
      <div
        className="relative bg-surface-1 border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden"
        style={{ width: "min(94vw, 1200px)", height: "min(92vh, 900px)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-surface-2 border-b border-border shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[13px] font-mono text-text-tertiary truncate">{file}</span>
            <button
              onClick={() => {
                navigator.clipboard.writeText(file);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              title="Copy file path"
              className="shrink-0 cursor-pointer text-text-tertiary hover:text-text-secondary"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 cursor-pointer text-text-tertiary hover:text-foreground p-1"
          >
            <X size={16} />
          </button>
        </div>

        {/* Code */}
        <div className="flex-1 overflow-auto subtle-scrollbar text-[13px] leading-relaxed">
          {highlightedHtml ? (
            <div
              className="shiki-container"
              dangerouslySetInnerHTML={{ __html: highlightedHtml }}
            />
          ) : sourceCode ? (
            <pre className="p-4 text-text-secondary font-mono whitespace-pre">
              {sourceCode}
            </pre>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ─── Shared ─── */

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-medium uppercase tracking-wider text-text-tertiary mb-1.5 shrink-0">
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
