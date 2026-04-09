"use client";

import type { DataTrace } from "@/types/graph";

export type RenderMode = "reactflow" | "mermaid";

interface HeaderProps {
  repoName?: string;
  traces: DataTrace[];
  activeTrace: string | null;
  onActiveTraceChange: (traceId: string | null) => void;
  onGoHome: () => void;
  renderMode: RenderMode;
  onRenderModeChange: (mode: RenderMode) => void;
  hasMermaid: boolean;
}

export function Header({
  repoName,
  traces,
  activeTrace,
  onActiveTraceChange,
  onGoHome,
  renderMode,
  onRenderModeChange,
  hasMermaid,
}: HeaderProps) {
  function toggleRenderMode() {
    onRenderModeChange(renderMode === "reactflow" ? "mermaid" : "reactflow");
  }

  // No graph loaded — minimal header
  if (!repoName) {
    return (
      <header className="flex items-center px-5 h-12 shrink-0 z-10">
        <span className="text-sm font-semibold text-foreground tracking-tight">
          SeeCode
        </span>
      </header>
    );
  }

  return (
    <header className="flex items-center gap-3 px-5 h-12 border-b border-border shrink-0 z-10">
      <button
        onClick={onGoHome}
        className="text-sm font-semibold text-text-secondary hover:text-foreground tracking-tight shrink-0 cursor-pointer transition-colors"
      >
        SeeCode
      </button>

      <span className="text-text-tertiary text-xs select-none">/</span>

      <span className="text-sm text-foreground font-medium truncate">
        {repoName}
      </span>

      <div className="flex-1" />

      <div className="flex items-center gap-2 shrink-0">
        {traces.length > 0 && (
          <select
            value={activeTrace ?? ""}
            onChange={(e) => onActiveTraceChange(e.target.value || null)}
            className="px-2 py-1 text-[11px] bg-transparent border border-border rounded text-text-secondary focus:outline-none focus:border-accent cursor-pointer"
          >
            <option value="">No trace</option>
            {traces.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name}
              </option>
            ))}
          </select>
        )}

        {hasMermaid && (
          <button
            onClick={toggleRenderMode}
            className="px-2 py-1 text-[11px] rounded border border-border text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer"
          >
            {renderMode === "reactflow" ? "Mermaid" : "Graph"}
          </button>
        )}
      </div>
    </header>
  );
}
