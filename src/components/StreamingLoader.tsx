"use client";

import { useEffect, useRef } from "react";
import { DotLoader } from "./DotLoader";

interface StreamingLoaderProps {
  status: string;
  streamedText: string;
  onStop: () => void;
}

export function StreamingLoader({ status, streamedText, onStop }: StreamingLoaderProps) {
  const textRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (textRef.current) {
      textRef.current.scrollTop = textRef.current.scrollHeight;
    }
  }, [streamedText]);

  return (
    <div className="absolute inset-0 flex flex-col" style={{ padding: "8% 12%" }}>
      {/* Status + stop button */}
      <div className="flex items-center gap-3 mb-4 shrink-0">
        <DotLoader />
        <p className="text-text-secondary text-sm flex-1">{status}</p>
        <button
          onClick={onStop}
          className="px-3 py-1.5 text-xs text-text-secondary bg-surface-2 border border-border rounded-md hover:text-foreground hover:border-border-strong transition-colors cursor-pointer"
        >
          Stop
        </button>
      </div>

      {/* Streaming text — fullscreen, semi-transparent, mono, no scrollbar */}
      <div
        ref={textRef}
        className="flex-1 overflow-auto min-h-0 subtle-scrollbar"
      >
        <p className="font-mono text-[12px] leading-[1.7] text-text-tertiary/50 whitespace-pre-wrap break-words selection:bg-accent/20">
          {streamedText}
          {streamedText && <span className="animate-pulse text-accent/60">|</span>}
        </p>
      </div>
    </div>
  );
}
