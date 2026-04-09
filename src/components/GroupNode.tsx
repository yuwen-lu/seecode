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
        className={`rounded-xl px-4 py-3 bg-surface-1 border border-border${data.highlighted ? " node-chat-highlight" : ""}`}
        style={{
          width: 280,
          opacity: data.dimmed ? 0.5 : 1,
        }}
      >
        {/* Category accent + group name */}
        <div className="flex items-center gap-1.5 mb-0.5">
          <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: colors.border }} />
          <span className="text-[10px] font-medium uppercase tracking-wide" style={{ color: colors.border }}>
            {CATEGORY_LABELS[data.category]}
          </span>
        </div>
        <div className="text-sm font-bold leading-snug mb-1.5 text-foreground">
          {data.label}
        </div>

        {/* Member list */}
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 mb-2">
          {data.members.map((m) => (
            <span key={m.id} className="text-[10px] leading-snug truncate text-text-secondary">
              {m.name}
            </span>
          ))}
        </div>

        {/* Stats */}
        <div className="text-[9px] pt-1.5 text-text-tertiary border-t border-border">
          {data.memberCount} module{data.memberCount !== 1 ? "s" : ""}
          {data.totalLines > 0 ? ` · ${data.totalLines.toLocaleString()} lines` : ""}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-transparent !border-0 !w-3 !h-3" />
    </>
  );
});
