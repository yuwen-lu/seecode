"use client";

import { memo } from "react";
import { Handle, Position, useViewport } from "@xyflow/react";
import type { ArchModule } from "@/types/graph";
import { CATEGORY_COLORS, CATEGORY_LABELS } from "@/types/graph";

interface ArchNodeData {
  module: ArchModule;
}

export const ArchNode = memo(function ArchNode({
  data,
  selected,
}: {
  data: ArchNodeData;
  selected?: boolean;
}) {
  const { zoom } = useViewport();
  const { module: mod } = data;
  const colors = CATEGORY_COLORS[mod.category];

  // Semantic zoom levels
  const showDetail = zoom > 0.7;
  const showClasses = zoom > 0.4;

  return (
    <>
      <Handle type="target" position={Position.Top} className="!bg-transparent !border-0 !w-2 !h-2" />
      <div
        className="rounded-lg px-3 py-2 min-w-[180px] max-w-[260px] transition-shadow"
        style={{
          background: colors.bg,
          border: `2px solid ${selected ? colors.border : colors.border + "88"}`,
          boxShadow: selected
            ? `0 0 16px ${colors.border}33`
            : "0 2px 8px rgba(0,0,0,0.3)",
        }}
      >
        {/* Header: name + category badge */}
        <div className="flex items-start justify-between gap-2 mb-1">
          <span
            className="text-sm font-semibold leading-tight"
            style={{ color: colors.text }}
          >
            {mod.name}
          </span>
          <span
            className="text-[9px] px-1.5 py-0.5 rounded shrink-0 font-medium"
            style={{
              background: colors.border + "22",
              color: colors.border,
              border: `1px solid ${colors.border}44`,
            }}
          >
            {CATEGORY_LABELS[mod.category]}
          </span>
        </div>

        {/* Responsibility (compact view) */}
        {showClasses && (
          <p
            className="text-[10px] leading-tight mb-1"
            style={{ color: colors.text + "99" }}
          >
            {mod.responsibility}
          </p>
        )}

        {/* Detail view: key types and methods */}
        {showDetail && mod.keyTypes.length > 0 && (
          <div className="mt-1.5 pt-1.5" style={{ borderTop: `1px solid ${colors.border}33` }}>
            <div className="flex flex-wrap gap-1">
              {mod.keyTypes.slice(0, 4).map((t) => (
                <span
                  key={t}
                  className="text-[9px] px-1 py-0.5 rounded font-mono"
                  style={{ background: colors.border + "15", color: colors.text + "cc" }}
                >
                  {t}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* File count / line count */}
        {showClasses && (
          <div
            className="text-[9px] mt-1"
            style={{ color: colors.text + "55" }}
          >
            {mod.files.length} file{mod.files.length !== 1 ? "s" : ""}
            {mod.lineCount ? ` \u00b7 ${mod.lineCount} lines` : ""}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-transparent !border-0 !w-2 !h-2" />
    </>
  );
});
