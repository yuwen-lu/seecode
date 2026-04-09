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

  // Use zoomLevel from slider when available (locked mode)
  const showDetail = zoomLevel === "detailed";
  const showCompact = zoomLevel === "detailed" || zoomLevel === "compact";

  return (
    <>
      <Handle type="target" position={Position.Top} className="!bg-transparent !border-0 !w-2 !h-2" />
      <div
        className={`rounded-lg px-3 py-2${highlighted ? " node-chat-highlight" : ""}`}
        style={{
          width: 260,
          background: colors.bg,
          boxShadow: `0 1px 3px rgba(0,0,0,0.3), inset 0 1px 0 ${colors.border}44`,
          opacity: dimmed ? 0.5 : 1,
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

        {/* Key methods */}
        {showDetail && mod.keyMethods.length > 0 && (
          <div
            className="mt-1.5 pt-1.5 space-y-0.5"
            style={{ borderTop: `1px solid ${colors.border}18` }}
          >
            {mod.keyMethods.slice(0, 3).map((m) => (
              <div
                key={m}
                className="text-[9px] font-mono truncate"
                style={{ color: `${colors.text}77` }}
              >
                {m}
              </div>
            ))}
          </div>
        )}

        {/* Files */}
        {showDetail && mod.files.length > 0 && (
          <div
            className="mt-1.5 pt-1 space-y-0.5"
            style={{ borderTop: `1px solid ${colors.border}18` }}
          >
            {mod.files.slice(0, 3).map((f) => (
              <div
                key={f}
                className="text-[8px] font-mono truncate"
                style={{ color: `${colors.text}55` }}
              >
                {f}
              </div>
            ))}
            {mod.files.length > 3 && (
              <div
                className="text-[8px]"
                style={{ color: `${colors.text}44` }}
              >
                +{mod.files.length - 3} more
              </div>
            )}
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
