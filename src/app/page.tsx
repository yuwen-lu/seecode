"use client";

import { useState, useRef, useCallback } from "react";
import { Header, type RenderMode } from "@/components/Header";
import { GraphCanvas } from "@/components/GraphCanvas";
import { DetailPanel, type PanelDepth } from "@/components/DetailPanel";
import { MermaidDebugView } from "@/components/MermaidDebugView";
import { StreamingLoader } from "@/components/StreamingLoader";
import type { ArchGraph, PanelSelection } from "@/types/graph";
import { MOCK_CLICKY } from "@/lib/mock-clicky";

export default function Home() {
  const [graph, setGraph] = useState<ArchGraph | null>(MOCK_CLICKY);
  const [selection, setSelection] = useState<PanelSelection | null>(null);
  const [activeTrace, setActiveTrace] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renderMode, setRenderMode] = useState<RenderMode>("reactflow");
  const [loadingStatus, setLoadingStatus] = useState("Analyzing...");
  const [streamedText, setStreamedText] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  // Panel depth + highlight override driven by panel navigation
  const [panelDepth, setPanelDepth] = useState<PanelDepth | null>(null);
  const [highlightOverride, setHighlightOverride] = useState<string | null>(null);

  // Derive the selected node ID for canvas highlighting
  const selectedNodeId = highlightOverride
    ?? (selection
      ? selection.kind === "module"
        ? selection.module.id
        : `group-${selection.category}`
      : null);

  // Called by DetailPanel whenever its view changes
  const onPanelViewChange = useCallback((depth: PanelDepth, moduleId: string | null) => {
    setPanelDepth(depth);
    setHighlightOverride(moduleId);
  }, []);

  // Clear override when selection changes from the canvas
  const handleSelect = useCallback((sel: PanelSelection | null) => {
    setSelection(sel);
    setHighlightOverride(null);
    setPanelDepth(sel ? (sel.kind === "component" ? "component" : "module") : null);
  }, []);

  async function analyzeRepo(url: string) {
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    setLoading(true);
    setError(null);
    setGraph(null);
    setSelection(null);
    setActiveTrace(null);
    setLoadingStatus("Connecting...");
    setStreamedText("");

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
        signal: abort.signal,
      });

      if (!res.ok || !res.body) {
        let errMsg = `Server error (${res.status})`;
        try {
          const text = await res.text();
          const parsed = JSON.parse(text);
          if (parsed.error) errMsg = parsed.error;
        } catch { /* use default */ }
        throw new Error(errMsg);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        let eventType = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7);
          } else if (line.startsWith("data: ")) {
            const data = line.slice(6);
            try {
              const parsed = JSON.parse(data);
              handleSSEEvent(eventType, parsed);
            } catch {
              // Skip malformed JSON
            }
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  function handleSSEEvent(event: string, data: Record<string, unknown>) {
    switch (event) {
      case "status":
        setLoadingStatus(data.message as string);
        break;
      case "chunk":
        setStreamedText((prev) => prev + (data.text as string));
        break;
      case "result": {
        const graph = data as unknown as ArchGraph;
        if (!graph.modules || graph.modules.length === 0) {
          setError("No architecture modules were extracted. The LLM may have returned an unexpected format.");
          return;
        }
        setGraph(graph);
        break;
      }
      case "error":
        setError(data.error as string);
        break;
    }
  }

  return (
    <div className="flex flex-col h-full">
      <Header
        repoName={graph?.repoName}
        traces={graph?.traces ?? []}
        activeTrace={activeTrace}
        onActiveTraceChange={setActiveTrace}
        onAnalyze={analyzeRepo}
        loading={loading}
        renderMode={renderMode}
        onRenderModeChange={setRenderMode}
        hasMermaid={!!graph?.mermaid}
      />

      {/* Trace description bar */}
      {activeTrace && graph && (() => {
        const trace = graph.traces.find((t) => t.name === activeTrace);
        return trace ? (
          <div className="px-4 py-1.5 bg-surface-2 border-b border-border text-xs text-text-secondary flex items-center gap-2 shrink-0">
            <span className="text-accent font-medium">{trace.name}</span>
            <span className="text-text-tertiary">—</span>
            <span>{trace.description}</span>
          </div>
        ) : null;
      })()}

      <div className="flex flex-1 min-h-0">
        {/* Main canvas area */}
        <div className="flex-1 relative">
          {loading ? (
            <StreamingLoader
              status={loadingStatus}
              streamedText={streamedText}
              onStop={() => {
                abortRef.current?.abort();
                setLoading(false);
                setError("Analysis cancelled");
              }}
            />
          ) : error ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center max-w-lg">
                <p className="text-red-400 font-medium mb-2">Analysis failed</p>
                <p className="text-text-secondary text-sm">{error}</p>
              </div>
            </div>
          ) : !graph ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center max-w-md">
                <h2 className="text-2xl font-semibold mb-3 text-foreground">
                  Paste a GitHub URL to get started
                </h2>
                <p className="text-text-secondary text-sm">
                  SeeCode analyzes any public repository and generates an
                  interactive architecture diagram.
                </p>
              </div>
            </div>
          ) : null}

          {graph && renderMode === "reactflow" && (
            <GraphCanvas
              graph={graph}
              activeTrace={activeTrace}
              onSelect={handleSelect}
              selectedNodeId={selectedNodeId}
              panelDepth={panelDepth}
            />
          )}

          {graph && renderMode === "mermaid" && (
            graph.mermaid ? (
              <MermaidDebugView mermaidSource={graph.mermaid} />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center max-w-sm">
                  <p className="text-text-secondary text-sm">
                    No Mermaid diagram available for this analysis.
                  </p>
                </div>
              </div>
            )
          )}
        </div>

        {/* Detail panel */}
        {selection && (
          <DetailPanel
            selection={selection}
            sourceSnippets={graph?.sourceSnippets}
            onClose={() => handleSelect(null)}
            onViewChange={onPanelViewChange}
          />
        )}
      </div>
    </div>
  );
}
