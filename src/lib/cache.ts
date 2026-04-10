import type { ArchGraph } from "@/types/graph";

const store = new Map<string, ArchGraph>();

function key(repoUrl: string, commitSha: string) {
  return `${repoUrl}@${commitSha}`;
}

export function getCachedGraph(repoUrl: string, commitSha: string): ArchGraph | null {
  return store.get(key(repoUrl, commitSha)) ?? null;
}

export function getLatestCachedGraph(repoUrl: string): ArchGraph | null {
  let latest: ArchGraph | null = null;
  for (const graph of store.values()) {
    if (graph.repoUrl === repoUrl) {
      if (!latest || (graph.analyzedAt ?? "") > (latest.analyzedAt ?? "")) {
        latest = graph;
      }
    }
  }
  return latest;
}

export function cacheGraph(graph: ArchGraph): void {
  store.set(key(graph.repoUrl, graph.commitSha), graph);
}

export interface CachedRepoEntry {
  repoUrl: string;
  repoName: string;
  analyzedAt: string;
}

export function listCachedRepos(): CachedRepoEntry[] {
  const seen = new Map<string, CachedRepoEntry>();
  for (const graph of store.values()) {
    if (seen.has(graph.repoUrl)) continue;
    seen.set(graph.repoUrl, {
      repoUrl: graph.repoUrl,
      repoName: graph.repoName,
      analyzedAt: graph.analyzedAt ?? new Date().toISOString(),
    });
  }
  return Array.from(seen.values());
}
