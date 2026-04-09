"use client";

import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import type { ArchModule, NodeCategory } from "@/types/graph";
import { CATEGORY_COLORS, CATEGORY_LABELS } from "@/types/graph";

export interface GroupNodeData {
  [key: string]: unknown;
  category: NodeCategory;
  label: string;
  description: string;
  memberCount: number;
  members: ArchModule[];
  totalLines: number;
  dimmed?: boolean;
}

export const GroupNode = memo(function GroupNode({
  data,
  selected,
}: {
  data: GroupNodeData;
  selected?: boolean;
}) {
  const colors = CATEGORY_COLORS[data.category];

  return (
    <>
      <Handle type="target" position={Position.Top} className="!bg-transparent !border-0 !w-3 !h-3" />
      <div
        className="rounded-xl px-4 py-3 min-w-[200px] max-w-[300px]"
        style={{
          background: colors.bg,
          boxShadow: `0 1px 4px rgba(0,0,0,0.35), inset 0 1px 0 ${colors.border}44`,
          opacity: data.dimmed ? 0.25 : 1,
        }}
      >
        {/* Category + group name */}
        <span
          className="text-[10px] font-medium uppercase tracking-wide block mb-0.5"
          style={{ color: `${colors.border}cc` }}
        >
          {CATEGORY_LABELS[data.category]}
        </span>
        <div
          className="text-sm font-bold leading-snug mb-1"
          style={{ color: colors.text }}
        >
          {data.label}
        </div>

        {/* Description */}
        <p
          className="text-[10px] leading-snug mb-2"
          style={{ color: `${colors.text}88` }}
        >
          {data.description}
        </p>

        {/* Member names */}
        <div
          className="text-[9px] flex flex-wrap gap-x-2 gap-y-0.5"
          style={{ color: `${colors.text}66` }}
        >
          {data.members.slice(0, 5).map((m) => (
            <span key={m.id}>{m.name}</span>
          ))}
          {data.members.length > 5 && (
            <span>+{data.members.length - 5} more</span>
          )}
        </div>

        {/* Stats */}
        <div
          className="text-[9px] mt-2 pt-1.5"
          style={{ color: `${colors.text}44`, borderTop: `1px solid ${colors.border}22` }}
        >
          {data.memberCount} module{data.memberCount !== 1 ? "s" : ""}
          {data.totalLines > 0 ? ` · ${data.totalLines.toLocaleString()} lines` : ""}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-transparent !border-0 !w-3 !h-3" />
    </>
  );
});
