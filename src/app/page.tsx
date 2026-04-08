"use client";

import { useState } from "react";
import { Header } from "@/components/Header";
import { GraphCanvas } from "@/components/GraphCanvas";
import { DetailPanel } from "@/components/DetailPanel";
import type { ArchGraph, ArchModule } from "@/types/graph";
import { MOCK_CLICKY } from "@/lib/mock-clicky";

export default function Home() {
  const [graph, setGraph] = useState<ArchGraph | null>(MOCK_CLICKY);
  const [selectedNode, setSelectedNode] = useState<ArchModule | null>(null);
  const [activeTrace, setActiveTrace] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function analyzeRepo(url: string) {
    setLoading(true);
    setError(null);
    setGraph(null);
    setSelectedNode(null);
    setActiveTrace(null);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Analysis failed");
      }

      const data: ArchGraph = await res.json();
      setGraph(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
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
      />

      <div className="flex flex-1 min-h-0">
        {/* Main canvas area */}
        <div className="flex-1 relative">
          {!graph && !loading && (
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
          )}

          {loading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center">
                <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                <p className="text-text-secondary text-sm">
                  Analyzing repository...
                </p>
              </div>
            </div>
          )}

          {error && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center max-w-md">
                <p className="text-red-400 mb-2">Analysis failed</p>
                <p className="text-text-secondary text-sm">{error}</p>
              </div>
            </div>
          )}

          {graph && (
            <GraphCanvas
              graph={graph}
              activeTrace={activeTrace}
              onNodeSelect={setSelectedNode}
              selectedNodeId={selectedNode?.id ?? null}
            />
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
