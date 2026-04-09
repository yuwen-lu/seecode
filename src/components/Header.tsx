"use client";

import { useState } from "react";
import type { DataTrace } from "@/types/graph";

export type RenderMode = "reactflow" | "mermaid";

interface HeaderProps {
  repoName?: string;
  traces: DataTrace[];
  activeTrace: string | null;
  onActiveTraceChange: (traceId: string | null) => void;
  onAnalyze: (url: string) => void;
  loading: boolean;
  renderMode: RenderMode;
  onRenderModeChange: (mode: RenderMode) => void;
  hasMermaid: boolean;
}

export function Header({
  repoName,
  traces,
  activeTrace,
  onActiveTraceChange,
  onAnalyze,
  loading,
  renderMode,
  onRenderModeChange,
  hasMermaid,
}: HeaderProps) {
  const [url, setUrl] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (url.trim() && !loading) {
      onAnalyze(url.trim());
    }
  }

  function toggleRenderMode() {
    onRenderModeChange(renderMode === "reactflow" ? "mermaid" : "reactflow");
  }

  return (
    <header className="flex items-center gap-3 px-4 py-2.5 bg-surface-1 border-b border-border shrink-0 z-10">
      <h1 className="text-base font-semibold text-foreground shrink-0">
        SeeCode
      </h1>

      {repoName && (
        <span className="text-xs text-text-secondary bg-surface-2 px-2.5 py-1 rounded font-mono shrink-0">
          {repoName}
        </span>
      )}

      {/* URL Input */}
      <form onSubmit={handleSubmit} className="flex items-center gap-2 ml-2">
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://github.com/owner/repo"
          className="w-72 px-3 py-1.5 text-xs bg-background border border-border rounded-md text-foreground placeholder:text-text-tertiary focus:outline-none focus:border-accent"
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading || !url.trim()}
          className="px-3 py-1.5 text-xs font-medium bg-accent text-background rounded-md hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loading ? "Analyzing..." : "Analyze"}
        </button>
      </form>

      {/* Trace selector */}
      {traces.length > 0 && (
        <select
          value={activeTrace ?? ""}
          onChange={(e) =>
            onActiveTraceChange(e.target.value || null)
          }
          className="ml-2 px-2 py-1.5 text-xs bg-background border border-border rounded-md text-foreground focus:outline-none focus:border-accent"
        >
          <option value="">No trace</option>
          {traces.map((t) => (
            <option key={t.name} value={t.name}>
              {t.name}
            </option>
          ))}
        </select>
      )}

      <div className="ml-auto" />

      {/* Render mode toggle */}
      {repoName && (
        hasMermaid ? (
          <button
            onClick={toggleRenderMode}
            className="px-2.5 py-1 text-[11px] rounded border border-border bg-surface-2 text-text-secondary hover:text-foreground cursor-pointer shrink-0"
          >
            {renderMode === "reactflow" ? "Mermaid" : "React Flow"}
          </button>
        ) : (
          <span className="text-[11px] text-text-tertiary shrink-0">
            React Flow
          </span>
        )
      )}
    </header>
  );
}
