"use client";

import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import { FileCode, Box, Braces } from "lucide-react";
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
  const hasDetailContent = mod.files.length > 0 || mod.keyTypes.length > 0 || mod.keyMethods.length > 0;

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
        {/* Category label + name */}
        <span className="text-[8px] font-medium uppercase tracking-wide" style={{ color: colors.border }}>
          {CATEGORY_LABELS[mod.category]}
        </span>
        <div className="text-[13px] font-semibold leading-tight text-foreground truncate">
          {mod.name}
        </div>

        {/* Responsibility */}
        {showCompact && (
          <p className="text-[10px] leading-snug mt-1 text-text-secondary">
            {mod.responsibility}
          </p>
        )}

        {/* Detail content — always in DOM, animated expand/collapse */}
        {hasDetailContent && (
          <div className={`node-detail-expand${showDetail ? " expanded" : ""}`}>
            <div>
              {mod.files.length > 0 && (
                <div className="mt-1.5 space-y-0.5">
                  {mod.files.slice(0, 3).map((f) => {
                    const parts = f.split("/");
                    const display = parts.length > 1 ? parts.slice(1).join("/") : f;
                    return (
                      <div key={f} title={f} className="flex items-center gap-1.5 text-[9px] font-mono truncate" style={{ color: colors.border }}>
                        <FileCode size={10} className="shrink-0 opacity-70" />
                        {display}
                      </div>
                    );
                  })}
                  {mod.files.length > 3 && (
                    <div className="text-[8px] pl-4 opacity-60" style={{ color: colors.border }}>
                      +{mod.files.length - 3} more
                    </div>
                  )}
                </div>
              )}

              {(mod.keyTypes.length > 0 || mod.keyMethods.length > 0) && (
                <div className="mt-1 ml-4 space-y-px">
                  {mod.keyTypes.slice(0, 4).map((t) => (
                    <div key={t} title={`Type / class: ${t}`} className="flex items-center gap-1 text-[9px] font-mono truncate text-text-tertiary">
                      <Box size={9} className="shrink-0" />
                      {t}
                    </div>
                  ))}
                  {mod.keyMethods.slice(0, 3).map((m) => (
                    <div key={m} title={`Method / function: ${m}`} className="flex items-center gap-1 text-[9px] font-mono truncate text-text-tertiary">
                      <Braces size={9} className="shrink-0" />
                      {m}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Stats line */}
        {showCompact && (
          <div className="text-[9px] mt-1.5 text-text-tertiary">
            {mod.files.length} file{mod.files.length !== 1 ? "s" : ""}
            {mod.lineCount ? ` · ${mod.lineCount} lines` : ""}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-transparent !border-0 !w-2 !h-2" />
    </>
  );
});
