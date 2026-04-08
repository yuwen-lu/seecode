"use client";

import { useState } from "react";
import type { DataTrace, NodeCategory } from "@/types/graph";
import { CATEGORY_COLORS, CATEGORY_LABELS } from "@/types/graph";

interface HeaderProps {
  repoName?: string;
  traces: DataTrace[];
  activeTrace: string | null;
  onActiveTraceChange: (traceId: string | null) => void;
  onAnalyze: (url: string) => void;
  loading: boolean;
}

const LEGEND_CATEGORIES: NodeCategory[] = [
  "core",
  "voice",
  "visual",
  "api-client",
  "proxy",
  "external",
  "utility",
];

export function Header({
  repoName,
  traces,
  activeTrace,
  onActiveTraceChange,
  onAnalyze,
  loading,
}: HeaderProps) {
  const [url, setUrl] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (url.trim() && !loading) {
      onAnalyze(url.trim());
    }
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

      {/* Legend */}
      {repoName && (
        <div className="flex items-center gap-3 ml-auto text-[11px] text-text-secondary shrink-0">
          {LEGEND_CATEGORIES.map((cat) => (
            <div key={cat} className="flex items-center gap-1">
              <div
                className="w-2 h-2 rounded-sm"
                style={{ background: CATEGORY_COLORS[cat].border }}
              />
              <span>{CATEGORY_LABELS[cat]}</span>
            </div>
          ))}
        </div>
      )}
    </header>
  );
}
