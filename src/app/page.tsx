"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Header } from "@/components/Header";
import { GraphCanvas } from "@/components/GraphCanvas";
import { DetailPanel, type PanelDepth } from "@/components/DetailPanel";
import { StreamingLoader } from "@/components/StreamingLoader";
import { ChatPanel } from "@/components/ChatPanel";
import type { ArchGraph, NodeCategory, PanelSelection } from "@/types/graph";
import { MOCK_CLICKY } from "@/lib/mock-clicky";
import { useChatStore } from "@/store/chat-store";
import { buildCanvasContext } from "@/lib/canvas-context";

interface RepoEntry {
  repoUrl: string;
  repoName: string;
  analyzedAt: string;
}

const RECENT_REPOS_KEY = "seecode:recent-repos";

function getRecentRepos(): RepoEntry[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_REPOS_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function saveRecentRepo(entry: RepoEntry) {
  const existing = getRecentRepos().filter((r) => r.repoUrl !== entry.repoUrl);
  const updated = [entry, ...existing].slice(0, 20);
  localStorage.setItem(RECENT_REPOS_KEY, JSON.stringify(updated));
}

export default function Home() {
  const [graph, setGraph] = useState<ArchGraph | null>(null);
  const [selection, setSelection] = useState<PanelSelection | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingStatus, setLoadingStatus] = useState("Analyzing...");
  const [streamedText, setStreamedText] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  // When the panel navigates to a module (e.g., from component view),
  // override the highlight so the canvas shows which node/group is relevant
  const [highlightOverride, setHighlightOverride] = useState<string | null>(null);
  const [panelExpandedCategory, setPanelExpandedCategory] = useState<NodeCategory | null>(null);
  const [panelDepth, setPanelDepth] = useState<PanelDepth | null>(null);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [initialFile, setInitialFile] = useState<string | null>(null);

  // Chat integration
  const chatHighlights = useChatStore((s) => s.highlights);
  const setCanvasContext = useChatStore((s) => s.setCanvasContext);
  const setChatRepoKey = useChatStore((s) => s.setRepoKey);
  const dynamicTrace = useChatStore((s) => s.activeTrace);
  const hoveredStepIndex = useChatStore((s) => s.hoveredStepIndex);
  const selectedNodeId = highlightOverride
    ?? (selection
      ? selection.kind === "module"
        ? selection.module.id
        : `group-${selection.category}`
      : null);

  // Panel reports view changes — update highlight + expansion request
  const onPanelViewChange = useCallback((depth: PanelDepth, moduleId: string | null, file?: string) => {
    setHighlightOverride(moduleId);
    setPanelDepth(depth);
    setActiveFile(file ?? null);
    if ((depth === "module" || depth === "file") && moduleId && graph) {
      const mod = graph.modules.find((m) => m.id === moduleId);
      setPanelExpandedCategory(mod?.category ?? null);
    } else {
      setPanelExpandedCategory(null);
    }
  }, [graph]);

  // Selection from canvas click — clears panel state
  const handleSelect = useCallback((sel: PanelSelection | null) => {
    setSelection(sel);
    setHighlightOverride(null);
    setInitialFile(null);
    // Don't touch panelExpandedCategory — canvas expansion is independent of panel open/close
  }, []);

  function loadGraph(g: ArchGraph) {
    setGraph(g);
    setSelection(null);
    setError(null);
    setHighlightOverride(null);
    setPanelExpandedCategory(null);
    saveRecentRepo({
      repoUrl: g.repoUrl,
      repoName: g.repoName,
      analyzedAt: g.analyzedAt ?? new Date().toISOString(),
    });
  }

  // Sync canvas context to chat store
  useEffect(() => {
    if (!graph) return;
    const ctx = buildCanvasContext(graph, selection, "system", panelDepth, activeFile);
    setCanvasContext(ctx);
  }, [graph, selection, panelDepth, activeFile, setCanvasContext]);

  // Init chat store when graph loads
  useEffect(() => {
    if (graph) setChatRepoKey(graph.repoUrl);
  }, [graph, setChatRepoKey]);

  // Handle file click from chat — expand category, select module, open file
  const handleChatFileClick = useCallback((filePath: string, moduleId: string, category: NodeCategory) => {
    if (!graph) return;
    const mod = graph.modules.find((m) => m.id === moduleId);
    if (mod) {
      setSelection({ kind: "module", module: mod });
      setHighlightOverride(moduleId);
      setPanelExpandedCategory(category);
      setInitialFile(filePath);
    }
  }, [graph]);

  function goHome() {
    abortRef.current?.abort();
    setGraph(null);
    setSelection(null);
    setLoading(false);
    setError(null);
    setStreamedText("");
    setHighlightOverride(null);
    setPanelExpandedCategory(null);
  }

  async function analyzeRepo(url: string) {
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    setLoading(true);
    setError(null);
    setGraph(null);
    setSelection(null);
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
        const g = data as unknown as ArchGraph;
        if (!g.modules || g.modules.length === 0) {
          setError("No architecture modules were extracted.");
          return;
        }
        loadGraph(g);
        break;
      }
      case "error":
        setError(data.error as string);
        break;
    }
  }

  const showHome = !graph && !loading && !error;

  return (
    <div className="flex flex-col h-full">
      <Header
        repoName={graph?.repoName}
        onGoHome={goHome}
      />

      <div className="flex-1 min-h-0 relative">
        {/* Detail panel — floating on LEFT side over canvas */}
        {selection && (
          <DetailPanel
            selection={selection}
            repoUrl={graph?.repoUrl ?? ""}
            commitSha={graph?.commitSha ?? ""}
            onClose={() => handleSelect(null)}
            onViewChange={onPanelViewChange}
            initialFile={initialFile}
          />
        )}

        {/* Canvas — fills full space */}
        <div className="absolute inset-0">
          {showHome && (
            <HomeView onAnalyze={analyzeRepo} mockGraph={MOCK_CLICKY} onLoadGraph={loadGraph} />
          )}

          {loading && (
            <StreamingLoader
              status={loadingStatus}
              streamedText={streamedText}
              onStop={() => {
                abortRef.current?.abort();
                setLoading(false);
                setError("Analysis cancelled");
              }}
            />
          )}

          {error && !loading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center max-w-lg">
                <p className="text-red-400 font-medium mb-2">Analysis failed</p>
                <p className="text-text-secondary text-sm mb-4">{error}</p>
                <button
                  onClick={goHome}
                  className="text-xs text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer"
                >
                  Back to home
                </button>
              </div>
            </div>
          )}

          {graph && (
            <GraphCanvas
              graph={graph}
              dynamicTrace={dynamicTrace}
              hoveredStepIndex={hoveredStepIndex}
              onSelect={handleSelect}
              selectedNodeId={selectedNodeId}
              panelExpandedCategory={panelExpandedCategory}
              panelOpen={!!selection}
              chatHighlights={chatHighlights}
            />
          )}
        </div>
      </div>

      {/* Chat panel — floating bottom-right overlay */}
      {graph && (
        <ChatPanel graph={graph} onFileClick={handleChatFileClick} />
      )}
    </div>
  );
}

/* ─── Home view ─── */

function HomeView({
  onAnalyze,
  mockGraph,
  onLoadGraph,
}: {
  onAnalyze: (url: string) => void;
  mockGraph?: ArchGraph;
  onLoadGraph?: (g: ArchGraph) => void;
}) {
  const [url, setUrl] = useState("");
  const [recentRepos, setRecentRepos] = useState<RepoEntry[]>([]);
  const [serverRepos, setServerRepos] = useState<RepoEntry[]>([]);

  useEffect(() => {
    setRecentRepos(getRecentRepos());
  }, []);

  useEffect(() => {
    fetch("/api/repos")
      .then((r) => r.json())
      .then((data: RepoEntry[]) => setServerRepos(data))
      .catch(() => {});
  }, []);

  const allRepos = mergeRepoLists(recentRepos, serverRepos);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (url.trim()) onAnalyze(url.trim());
  }

  function formatRelativeTime(dateStr: string): string {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 30) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  }

  return (
    <div className="absolute inset-0 flex items-start justify-center pt-[18vh]">
      <div className="w-full max-w-md px-6">
        <h2 className="text-lg font-semibold text-foreground mb-1">
          Understand any codebase
        </h2>
        <p className="text-text-secondary text-sm mb-6">
          Paste a GitHub repo to see its architecture, trace data flows, and chat with an AI that reads the actual source code.
        </p>

        <form onSubmit={handleSubmit} className="flex gap-2 mb-8">
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://github.com/owner/repo"
            aria-label="GitHub repository URL"
            className="flex-1 px-3 py-2 text-sm bg-surface-1 border border-border rounded-lg text-foreground placeholder:text-text-tertiary focus:outline-none focus:border-accent"
            autoFocus
          />
          <button
            type="submit"
            disabled={!url.trim()}
            className="px-4 py-2 text-sm font-medium bg-accent text-background rounded-lg hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shrink-0"
          >
            Analyze
          </button>
        </form>

        <div>
          {(mockGraph || allRepos.length > 0) && (
            <h3 className="text-[10px] font-medium uppercase tracking-wider text-text-tertiary mb-2">
              {allRepos.length > 0 ? "Recent" : "Demo"}
            </h3>
          )}
          <div className="space-y-0.5">
            {mockGraph && onLoadGraph && (
              <button
                onClick={() => onLoadGraph(mockGraph)}
                className="w-full text-left px-3 py-2 rounded-lg hover:bg-surface-1 transition-colors cursor-pointer group flex items-center justify-between gap-3"
              >
                <span className="text-sm text-foreground group-hover:text-accent transition-colors truncate">
                  {mockGraph.repoName}
                </span>
                <span className="text-[11px] text-text-tertiary shrink-0">
                  demo
                </span>
              </button>
            )}
            {allRepos.map((repo) => (
              <button
                key={repo.repoUrl}
                onClick={() => onAnalyze(repo.repoUrl)}
                className="w-full text-left px-3 py-2 rounded-lg hover:bg-surface-1 transition-colors cursor-pointer group flex items-center justify-between gap-3"
              >
                <span className="text-sm text-foreground group-hover:text-accent transition-colors truncate">
                  {repo.repoName}
                </span>
                <span className="text-[11px] text-text-tertiary shrink-0">
                  {formatRelativeTime(repo.analyzedAt)}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function mergeRepoLists(local: RepoEntry[], server: RepoEntry[]): RepoEntry[] {
  const seen = new Set<string>();
  const result: RepoEntry[] = [];
  for (const entry of [...local, ...server]) {
    if (seen.has(entry.repoUrl)) continue;
    seen.add(entry.repoUrl);
    result.push(entry);
  }
  return result;
}
