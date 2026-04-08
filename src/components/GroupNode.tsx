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
          border: `2.5px solid ${selected ? colors.border : colors.border + "99"}`,
          opacity: data.dimmed ? 0.25 : 1,
        }}
      >
        {/* Category badge */}
        <div className="flex items-center gap-2 mb-1.5">
          <div
            className="w-2.5 h-2.5 rounded-sm"
            style={{ background: colors.border }}
          />
          <span
            className="text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: colors.border }}
          >
            {CATEGORY_LABELS[data.category]}
          </span>
        </div>

        {/* Group name */}
        <div
          className="text-sm font-bold leading-snug mb-1"
          style={{ color: colors.text }}
        >
          {data.label}
        </div>

        {/* Description */}
        <p
          className="text-[10px] leading-snug mb-2"
          style={{ color: colors.text + "88" }}
        >
          {data.description}
        </p>

        {/* Member list */}
        <div
          className="text-[9px] flex flex-wrap gap-x-2 gap-y-0.5"
          style={{ color: colors.text + "66" }}
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
          className="text-[9px] mt-1.5 pt-1.5"
          style={{ color: colors.text + "44", borderTop: `1px solid ${colors.border}22` }}
        >
          {data.memberCount} component{data.memberCount !== 1 ? "s" : ""}
          {data.totalLines > 0 ? ` · ${data.totalLines.toLocaleString()} lines` : ""}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-transparent !border-0 !w-3 !h-3" />
    </>
  );
});
