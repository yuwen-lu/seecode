"use client";

import type { ArchModule } from "@/types/graph";
import { CATEGORY_COLORS, CATEGORY_LABELS } from "@/types/graph";

interface DetailPanelProps {
  module: ArchModule;
  onClose: () => void;
}

export function DetailPanel({ module: mod, onClose }: DetailPanelProps) {
  const colors = CATEGORY_COLORS[mod.category];

  return (
    <div className="w-[380px] shrink-0 bg-surface-1 border-l border-border flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="text-sm font-semibold text-foreground truncate">
            {mod.name}
          </h2>
          <span
            className="text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0"
            style={{
              background: colors.border + "22",
              color: colors.border,
              border: `1px solid ${colors.border}44`,
            }}
          >
            {CATEGORY_LABELS[mod.category]}
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-text-secondary hover:text-foreground text-lg px-1"
        >
          &times;
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-3 text-[13px] leading-relaxed">
        {/* Files */}
        <SectionTitle>Files</SectionTitle>
        {mod.files.map((f) => (
          <p key={f} className="text-[11px] font-mono text-text-tertiary">
            {f}
          </p>
        ))}
        {mod.lineCount && (
          <p className="text-[11px] text-text-tertiary mt-0.5">
            {mod.lineCount.toLocaleString()} lines
          </p>
        )}

        {/* Responsibility */}
        <SectionTitle>Responsibility</SectionTitle>
        <p className="text-text-secondary">{mod.responsibility}</p>

        {/* Key Types */}
        {mod.keyTypes.length > 0 && (
          <>
            <SectionTitle>Key Types</SectionTitle>
            <div className="flex flex-wrap gap-1.5">
              {mod.keyTypes.map((t) => (
                <span
                  key={t}
                  className="text-xs font-mono px-2 py-0.5 rounded bg-surface-2 text-accent"
                >
                  {t}
                </span>
              ))}
            </div>
          </>
        )}

        {/* Key Methods */}
        {mod.keyMethods.length > 0 && (
          <>
            <SectionTitle>Key Methods</SectionTitle>
            <ul className="space-y-0.5">
              {mod.keyMethods.map((m) => (
                <li
                  key={m}
                  className="text-xs font-mono text-text-secondary"
                >
                  {m}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-semibold uppercase tracking-wider text-accent mt-4 mb-1.5 first:mt-0">
      {children}
    </h3>
  );
}
