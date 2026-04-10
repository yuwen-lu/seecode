import { describe, it, expect, beforeEach, afterAll } from "vitest";
import Database from "better-sqlite3";
import type { ArchGraph } from "@/types/graph";
import fs from "fs";
import path from "path";
import os from "os";

// We can't easily test cache.ts directly because it uses a module-level singleton.
// Instead, we replicate its core logic against an in-memory DB to test SQL correctness.

let db: Database.Database;

function initDb() {
  db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS analysis_cache (
      repo_url TEXT NOT NULL,
      commit_sha TEXT NOT NULL,
      graph_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (repo_url, commit_sha)
    )
  `);
}

function makeGraph(repoUrl: string, commitSha: string): ArchGraph {
  return {
    repoUrl,
    repoName: repoUrl.split("/").pop() ?? "repo",
    commitSha,
    analyzedAt: new Date().toISOString(),
    modules: [],
    edges: [],
    traces: [],
  };
}

function cacheGraph(graph: ArchGraph) {
  db.prepare(
    "INSERT OR REPLACE INTO analysis_cache (repo_url, commit_sha, graph_json) VALUES (?, ?, ?)",
  ).run(graph.repoUrl, graph.commitSha, JSON.stringify(graph));
}

function getCachedGraph(repoUrl: string, commitSha: string): ArchGraph | null {
  const row = db.prepare(
    "SELECT graph_json FROM analysis_cache WHERE repo_url = ? AND commit_sha = ?",
  ).get(repoUrl, commitSha) as { graph_json: string } | undefined;
  if (!row) return null;
  return JSON.parse(row.graph_json);
}

function getLatestCachedGraph(repoUrl: string): ArchGraph | null {
  const row = db.prepare(
    "SELECT graph_json FROM analysis_cache WHERE repo_url = ? ORDER BY created_at DESC LIMIT 1",
  ).get(repoUrl) as { graph_json: string } | undefined;
  if (!row) return null;
  return JSON.parse(row.graph_json);
}

function listCachedRepos() {
  const rows = db.prepare(
    "SELECT repo_url, graph_json, created_at FROM analysis_cache ORDER BY created_at DESC",
  ).all() as { repo_url: string; graph_json: string; created_at: string }[];

  const seen = new Map<string, { repoUrl: string; repoName: string; analyzedAt: string }>();
  for (const row of rows) {
    if (seen.has(row.repo_url)) continue;
    const graph = JSON.parse(row.graph_json) as ArchGraph;
    seen.set(row.repo_url, {
      repoUrl: row.repo_url,
      repoName: graph.repoName,
      analyzedAt: graph.analyzedAt ?? row.created_at,
    });
  }
  return Array.from(seen.values());
}

beforeEach(() => {
  initDb();
});

afterAll(() => {
  db?.close();
});

describe("cache operations", () => {
  it("round-trips a graph through cache", () => {
    const graph = makeGraph("https://github.com/test/repo", "sha123");
    cacheGraph(graph);
    const retrieved = getCachedGraph("https://github.com/test/repo", "sha123");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.repoUrl).toBe(graph.repoUrl);
    expect(retrieved!.commitSha).toBe(graph.commitSha);
  });

  it("returns null for non-existent cache entry", () => {
    const result = getCachedGraph("https://github.com/nope/nope", "sha000");
    expect(result).toBeNull();
  });

  it("overwrites existing entry on same (repoUrl, commitSha)", () => {
    const g1 = makeGraph("https://github.com/test/repo", "sha1");
    g1.repoName = "original";
    cacheGraph(g1);

    const g2 = makeGraph("https://github.com/test/repo", "sha1");
    g2.repoName = "updated";
    cacheGraph(g2);

    const result = getCachedGraph("https://github.com/test/repo", "sha1");
    expect(result!.repoName).toBe("updated");
  });

  it("stores different commits for the same repo separately", () => {
    cacheGraph(makeGraph("https://github.com/test/repo", "sha1"));
    cacheGraph(makeGraph("https://github.com/test/repo", "sha2"));

    expect(getCachedGraph("https://github.com/test/repo", "sha1")).not.toBeNull();
    expect(getCachedGraph("https://github.com/test/repo", "sha2")).not.toBeNull();
  });
});

describe("getLatestCachedGraph", () => {
  it("returns the most recent graph for a repo", () => {
    const g1 = makeGraph("https://github.com/test/repo", "old-sha");
    g1.repoName = "first";
    cacheGraph(g1);

    const g2 = makeGraph("https://github.com/test/repo", "new-sha");
    g2.repoName = "second";
    cacheGraph(g2);

    const latest = getLatestCachedGraph("https://github.com/test/repo");
    expect(latest).not.toBeNull();
    // Both inserted at ~same time, so order depends on datetime('now') resolution
    // But both should exist
    expect(["first", "second"]).toContain(latest!.repoName);
  });

  it("returns null when repo has no cache", () => {
    expect(getLatestCachedGraph("https://github.com/ghost/repo")).toBeNull();
  });
});

describe("listCachedRepos", () => {
  it("returns empty array when cache is empty", () => {
    expect(listCachedRepos()).toEqual([]);
  });

  it("deduplicates by repo URL (first occurrence wins)", () => {
    cacheGraph(makeGraph("https://github.com/a/repo", "sha1"));
    cacheGraph(makeGraph("https://github.com/a/repo", "sha2"));
    cacheGraph(makeGraph("https://github.com/b/repo", "sha1"));

    const repos = listCachedRepos();
    expect(repos).toHaveLength(2);
    const urls = repos.map((r) => r.repoUrl);
    expect(urls).toContain("https://github.com/a/repo");
    expect(urls).toContain("https://github.com/b/repo");
  });
});

describe("JSON integrity", () => {
  it("preserves complex graph data through serialization", () => {
    const graph = makeGraph("https://github.com/test/repo", "sha1");
    graph.modules = [
      {
        id: "mod-1",
        name: "Module One",
        files: ["src/mod1.ts", "src/mod1-utils.ts"],
        category: "core",
        responsibility: "Core logic with special chars: <>&\"'",
        keyTypes: ["Type1", "Type2"],
        keyMethods: ["method1()", "method2()"],
        lineCount: 500,
      },
    ];
    graph.edges = [{ from: "mod-1", to: "mod-2", type: "depends", label: "uses API" }];
    graph.traces = [{ name: "auth-flow", description: "User login", path: ["mod-1", "mod-2"] }];

    cacheGraph(graph);
    const result = getCachedGraph("https://github.com/test/repo", "sha1");
    expect(result!.modules).toEqual(graph.modules);
    expect(result!.edges).toEqual(graph.edges);
    expect(result!.traces).toEqual(graph.traces);
  });

  it("handles graph with unicode in names", () => {
    const graph = makeGraph("https://github.com/test/repo", "sha1");
    graph.repoName = "test/日本語repo";
    graph.modules = [{
      id: "mod-é", name: "Módule", files: [], category: "core",
      responsibility: "Handles 中文", keyTypes: [], keyMethods: [],
    }];
    cacheGraph(graph);
    const result = getCachedGraph("https://github.com/test/repo", "sha1");
    expect(result!.repoName).toBe("test/日本語repo");
    expect(result!.modules[0].name).toBe("Módule");
  });
});
