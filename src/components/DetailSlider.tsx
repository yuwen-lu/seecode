"use client";

import { Lock, Unlock } from "lucide-react";
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
        className={`w-7 h-7 flex items-center justify-center rounded-md border transition-colors cursor-pointer ${
          locked
            ? "bg-accent/10 border-accent/30 text-accent"
            : "bg-surface-1 border-border text-text-tertiary hover:text-text-secondary"
        }`}
        title={locked ? "Unlock: zoom controls detail level" : "Lock: keep current detail level while zooming"}
      >
        {locked ? <Lock size={12} /> : <Unlock size={12} />}
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
            className={`group relative w-6 h-7 flex items-center justify-center rounded transition-colors cursor-pointer ${
              i === activeIndex
                ? "bg-accent/15"
                : "hover:bg-surface-2"
            }`}
            title={`${l.label}: ${l.short}`}
          >
            <div
              className={`w-1.5 h-1.5 rounded-full transition-colors ${
                i === activeIndex ? "bg-accent" : "bg-text-tertiary/25"
              }`}
            />
            {/* Tooltip */}
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
      <span className="text-[9px] text-text-tertiary text-center leading-tight select-none">
        {LEVELS[activeIndex]?.label}
      </span>
    </div>
  );
}
