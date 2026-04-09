"use client";

import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import type { ArchModule } from "@/types/graph";
import { getCategoryColors, CATEGORY_LABELS } from "@/types/graph";
import type { ZoomLevel } from "@/lib/semantic-zoom";

interface ArchNodeData {
  module: ArchModule;
  dimmed?: boolean;
  zoomLevel?: ZoomLevel;
  highlighted?: boolean;
  isDark?: boolean;
}

export const ArchNode = memo(function ArchNode({
  data,
}: {
  data: ArchNodeData;
  selected?: boolean;
}) {
  const { module: mod, dimmed, zoomLevel, highlighted, isDark } = data;
  const colors = getCategoryColors(isDark)[mod.category];

  const showDetail = zoomLevel === "detailed";
  const showCompact = zoomLevel === "detailed" || zoomLevel === "compact";

  return (
    <>
      <Handle type="target" position={Position.Top} className="!bg-transparent !border-0 !w-2 !h-2" />
      <div
        className={`rounded-lg px-3 py-2 bg-surface-1 border border-border${highlighted ? " node-chat-highlight" : ""}`}
        style={{
          width: 260,
          opacity: dimmed ? 0.5 : 1,
        }}
      >
        {/* Category accent + name */}
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: colors.border }} />
          <span className="text-[13px] font-semibold leading-tight text-foreground truncate">
            {mod.name}
          </span>
        </div>

        {/* Responsibility */}
        {showCompact && (
          <p className="text-[10px] leading-snug mt-1 text-text-secondary">
            {mod.responsibility}
          </p>
        )}

        {/* Key types */}
        {showDetail && mod.keyTypes.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {mod.keyTypes.slice(0, 4).map((t) => (
              <span
                key={t}
                className="text-[9px] px-1 py-0.5 rounded font-mono bg-surface-2 text-text-secondary"
              >
                {t}
              </span>
            ))}
          </div>
        )}

        {/* Key methods */}
        {showDetail && mod.keyMethods.length > 0 && (
          <div className="mt-1.5 pt-1.5 space-y-0.5 border-t border-border">
            {mod.keyMethods.slice(0, 3).map((m) => (
              <div key={m} className="text-[9px] font-mono truncate text-text-tertiary">
                {m}
              </div>
            ))}
          </div>
        )}

        {/* Files */}
        {showDetail && mod.files.length > 0 && (
          <div className="mt-1.5 pt-1 space-y-0.5 border-t border-border">
            {mod.files.slice(0, 3).map((f) => (
              <div key={f} className="text-[8px] font-mono truncate text-text-tertiary">
                {f}
              </div>
            ))}
            {mod.files.length > 3 && (
              <div className="text-[8px] text-text-tertiary">
                +{mod.files.length - 3} more
              </div>
            )}
          </div>
        )}

        {/* Stats line */}
        {showCompact && (
          <div className="text-[9px] mt-1.5 flex items-center gap-1.5 text-text-tertiary">
            <span className="text-[8px] font-medium uppercase tracking-wide" style={{ color: colors.border }}>
              {CATEGORY_LABELS[mod.category]}
            </span>
            <span>·</span>
            {mod.files.length} file{mod.files.length !== 1 ? "s" : ""}
            {mod.lineCount ? ` · ${mod.lineCount} lines` : ""}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-transparent !border-0 !w-2 !h-2" />
    </>
  );
});
