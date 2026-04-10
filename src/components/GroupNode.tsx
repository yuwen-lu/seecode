"use client";

import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import type { ArchModule, NodeCategory } from "@/types/graph";
import { getCategoryColors, CATEGORY_LABELS } from "@/types/graph";

export interface GroupNodeData {
  [key: string]: unknown;
  category: NodeCategory;
  label: string;
  description: string;
  memberCount: number;
  members: ArchModule[];
  totalLines: number;
  dimmed?: boolean;
  highlighted?: boolean;
  isDark?: boolean;
}

export const GroupNode = memo(function GroupNode({
  data,
  selected,
}: {
  data: GroupNodeData;
  selected?: boolean;
}) {
  const colors = getCategoryColors(data.isDark)[data.category];

  return (
    <>
      <Handle type="target" position={Position.Top} className="!bg-transparent !border-0 !w-3 !h-3" />
      <div
        className={`rounded-xl px-5 py-4 bg-surface-1 border border-border${data.highlighted ? " node-chat-highlight" : ""}`}
        style={{
          width: 400,
          opacity: data.dimmed ? 0.5 : 1,
        }}
      >
        {/* Category accent + group name */}
        <div className="flex items-center gap-2 mb-1">
          <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: colors.border }} />
          <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: colors.border }}>
            {CATEGORY_LABELS[data.category]}
          </span>
        </div>
        <div className="text-xl font-bold leading-snug mb-2.5 text-foreground">
          {data.label}
        </div>

        {/* Member list */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 mb-3">
          {data.members.map((m) => (
            <span key={m.id} className="text-[11px] leading-snug truncate text-text-secondary">
              {m.name}
            </span>
          ))}
        </div>

        {/* Stats */}
        <div className="text-[10px] pt-2 text-text-tertiary border-t border-border">
          {data.memberCount} module{data.memberCount !== 1 ? "s" : ""}
          {data.totalLines > 0 ? ` · ${data.totalLines.toLocaleString()} lines` : ""}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-transparent !border-0 !w-3 !h-3" />
    </>
  );
});
