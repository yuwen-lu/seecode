"use client";

import { useState, useRef } from "react";
import { Header, type RenderMode } from "@/components/Header";
import { GraphCanvas } from "@/components/GraphCanvas";
import { DetailPanel } from "@/components/DetailPanel";
import { MermaidDebugView } from "@/components/MermaidDebugView";
import { StreamingLoader } from "@/components/StreamingLoader";
import type { ArchGraph, ArchModule, NodeCategory } from "@/types/graph";
import { MOCK_CLICKY } from "@/lib/mock-clicky";

export default function Home() {
  const [graph, setGraph] = useState<ArchGraph | null>(MOCK_CLICKY);
  const [selectedNode, setSelectedNode] = useState<ArchModule | null>(null);
  const [activeTrace, setActiveTrace] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renderMode, setRenderMode] = useState<RenderMode>("reactflow");
  const [loadingStatus, setLoadingStatus] = useState("Analyzing...");
  const [streamedText, setStreamedText] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  async function analyzeRepo(url: string) {
    // Abort any in-flight request
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    setLoading(true);
    setError(null);
    setGraph(null);
    setSelectedNode(null);
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
        // Try to parse error from body
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

        // Parse SSE events from buffer
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? ""; // Keep incomplete line in buffer

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
        activeCategories={graph ? [...new Set(graph.modules.map((m) => m.category))] as NodeCategory[] : undefined}
      />

      <div className="flex flex-1 min-h-0">
        {/* Main canvas area */}
        <div className="flex-1 relative">
          {/* States are mutually exclusive */}
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
              onNodeSelect={setSelectedNode}
              selectedNodeId={selectedNode?.id ?? null}
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
        {selectedNode && (
          <DetailPanel
            module={selectedNode}
            onClose={() => setSelectedNode(null)}
          />
        )}
      </div>
    </div>
  );
}
