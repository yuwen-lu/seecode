"use client";

import { useEffect, useRef, useState } from "react";

interface MermaidDebugViewProps {
  mermaidSource: string;
}

export function MermaidDebugView({ mermaidSource }: MermaidDebugViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function render() {
      if (!containerRef.current || !mermaidSource) return;

      try {
        // Dynamic import to avoid SSR issues
        const mermaid = (await import("mermaid")).default;
        if (cancelled) return;

        mermaid.initialize({
          startOnLoad: false,
          theme: "dark",
          themeVariables: {
            darkMode: true,
            background: "#0a0a0f",
            primaryColor: "#1e3a5f",
            primaryBorderColor: "#3a6a9f",
            primaryTextColor: "#e0e0e0",
            lineColor: "#4a5568",
            fontSize: "14px",
            clusterBkg: "#111122",
            clusterBorder: "#2a2a4a",
          },
          flowchart: {
            curve: "basis",
            padding: 20,
            nodeSpacing: 50,
            rankSpacing: 60,
          },
        });

        const id = `mermaid-debug-${Date.now()}`;
        const { svg } = await mermaid.render(id, mermaidSource);
        if (cancelled || !containerRef.current) return;

        containerRef.current.innerHTML = svg;
        setError(null);
        setLoaded(true);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to render Mermaid diagram");
        }
      }
    }

    render();
    return () => { cancelled = true; };
  }, [mermaidSource]);

  return (
    <div className="h-full w-full overflow-auto bg-background relative">
      {/* Raw source toggle */}
      <details className="absolute top-3 right-3 z-10">
        <summary className="text-[11px] text-text-tertiary cursor-pointer bg-surface-1 px-2 py-1 rounded border border-border hover:text-text-secondary">
          View source
        </summary>
        <pre className="mt-1 p-3 bg-surface-1 border border-border rounded-lg text-[11px] font-mono text-text-secondary max-w-xl max-h-80 overflow-auto whitespace-pre-wrap">
          {mermaidSource}
        </pre>
      </details>

      {error && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center max-w-md">
            <p className="text-red-400 text-sm mb-2">Mermaid rendering error</p>
            <pre className="text-[11px] text-text-tertiary bg-surface-1 p-3 rounded overflow-auto max-h-40">
              {error}
            </pre>
          </div>
        </div>
      )}

      <div
        ref={containerRef}
        className="flex items-center justify-center min-h-full p-8"
        style={{ opacity: loaded ? 1 : 0.3 }}
      />
    </div>
  );
}
