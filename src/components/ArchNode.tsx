"use client";

import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import type { ArchModule } from "@/types/graph";
import { CATEGORY_COLORS, CATEGORY_LABELS } from "@/types/graph";
import type { ZoomLevel } from "@/lib/semantic-zoom";

interface ArchNodeData {
  module: ArchModule;
  dimmed?: boolean;
  zoomLevel?: ZoomLevel;
}

export const ArchNode = memo(function ArchNode({
  data,
  selected,
}: {
  data: ArchNodeData;
  selected?: boolean;
}) {
  const { module: mod, dimmed, zoomLevel } = data;
  const colors = CATEGORY_COLORS[mod.category];

  // Use zoomLevel from slider when available (locked mode)
  const showDetail = zoomLevel === "detailed";
  const showCompact = zoomLevel === "detailed" || zoomLevel === "compact";

  return (
    <>
      <Handle type="target" position={Position.Top} className="!bg-transparent !border-0 !w-2 !h-2" />
      <div
        className="rounded-lg px-3 py-2 min-w-[180px] max-w-[260px]"
        style={{
          background: colors.bg,
          boxShadow: selected
            ? `0 0 0 1.5px ${colors.border}`
            : `0 1px 3px rgba(0,0,0,0.3), inset 0 1px 0 ${colors.border}44`,
          opacity: dimmed ? 0.25 : 1,
        }}
      >
        {/* Name */}
        <span
          className="text-[13px] font-semibold leading-tight block"
          style={{ color: colors.text }}
        >
          {mod.name}
        </span>

        {/* Responsibility */}
        {showCompact && (
          <p
            className="text-[10px] leading-snug mt-1"
            style={{ color: `${colors.text}99` }}
          >
            {mod.responsibility}
          </p>
        )}

        {/* Key types */}
        {showDetail && mod.keyTypes.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {mod.keyTypes.slice(0, 4).map((t) => (
              <span
                key={t}
                className="text-[9px] px-1 py-0.5 rounded font-mono"
                style={{ background: `${colors.border}15`, color: `${colors.text}cc` }}
              >
                {t}
              </span>
            ))}
          </div>
        )}

        {/* Stats line */}
        {showCompact && (
          <div
            className="text-[9px] mt-1.5 flex items-center gap-1.5"
            style={{ color: `${colors.text}55` }}
          >
            <span
              className="text-[8px] font-medium uppercase tracking-wide"
              style={{ color: `${colors.border}cc` }}
            >
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
