"use client";

import type { ZoomLevel } from "@/lib/semantic-zoom";

interface DetailSliderProps {
  level: ZoomLevel;
  locked: boolean;
  onLevelChange: (level: ZoomLevel) => void;
  onLockedChange: (locked: boolean) => void;
}

const LEVELS: { key: ZoomLevel; label: string; short: string }[] = [
  { key: "collapsed", label: "System", short: "High-level components" },
  { key: "compact", label: "Module", short: "Names & roles" },
  { key: "detailed", label: "Detail", short: "Methods & types" },
];

export function DetailSlider({ level, locked, onLevelChange, onLockedChange }: DetailSliderProps) {
  const activeIndex = LEVELS.findIndex((l) => l.key === level);

  return (
    <div className="absolute bottom-4 right-4 z-10 flex flex-col items-center gap-1.5">
      {/* Lock toggle */}
      <button
        onClick={() => onLockedChange(!locked)}
        className={`w-7 h-7 flex items-center justify-center rounded-md border text-[11px] transition-colors ${
          locked
            ? "bg-accent/15 border-accent/40 text-accent"
            : "bg-surface-1 border-border text-text-tertiary hover:text-text-secondary"
        }`}
        title={locked ? "Unlock: zoom controls detail level" : "Lock: keep current detail level while zooming"}
      >
        {locked ? (
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <path d="M11 6V4a3 3 0 0 0-6 0v2H4a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-1zm-4-2a1 1 0 1 1 2 0v2H7V4z"/>
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <path d="M11 6h1a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h1V4a3 3 0 0 1 5.12-2.12L8.7 3.3A1 1 0 0 0 7 4v2h4z"/>
          </svg>
        )}
      </button>

      {/* Vertical slider track */}
      <div className="flex flex-col items-center bg-surface-1 border border-border rounded-lg p-1.5 gap-0.5">
        {LEVELS.map((l, i) => (
          <button
            key={l.key}
            onClick={() => {
              onLevelChange(l.key);
              if (!locked) onLockedChange(true);
            }}
            className={`group relative w-6 h-8 flex items-center justify-center rounded transition-colors ${
              i === activeIndex
                ? "bg-accent/20"
                : "hover:bg-surface-2"
            }`}
            title={`${l.label}: ${l.short}`}
          >
            {/* Dot indicator */}
            <div
              className={`w-2 h-2 rounded-full transition-colors ${
                i === activeIndex ? "bg-accent" : "bg-text-tertiary/30"
              }`}
            />
            {/* Tooltip on hover */}
            <div className="absolute right-full mr-2 hidden group-hover:flex items-center whitespace-nowrap pointer-events-none">
              <span className="text-[10px] text-text-secondary bg-surface-1 border border-border rounded px-2 py-1 shadow-lg">
                {l.label}
                <span className="text-text-tertiary"> — {l.short}</span>
              </span>
            </div>
          </button>
        ))}
      </div>

      {/* Current level label */}
      <span className="text-[9px] text-text-tertiary text-center leading-tight">
        {LEVELS[activeIndex]?.label}
      </span>
    </div>
  );
}
