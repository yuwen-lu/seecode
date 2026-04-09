import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import type { ArchGraph } from "@/types/graph";

const DB_PATH = path.join(process.cwd(), ".seecode-cache.db");

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (db) return db;

  db = new Database(DB_PATH);
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
  return db;
}

export function getCachedGraph(repoUrl: string, commitSha: string): ArchGraph | null {
  try {
    const row = getDb()
      .prepare("SELECT graph_json FROM analysis_cache WHERE repo_url = ? AND commit_sha = ?")
      .get(repoUrl, commitSha) as { graph_json: string } | undefined;

    if (!row) return null;
    return JSON.parse(row.graph_json) as ArchGraph;
  } catch {
    return null;
  }
}

export function cacheGraph(graph: ArchGraph): void {
  try {
    getDb()
      .prepare(
        "INSERT OR REPLACE INTO analysis_cache (repo_url, commit_sha, graph_json) VALUES (?, ?, ?)"
      )
      .run(graph.repoUrl, graph.commitSha, JSON.stringify(graph));
  } catch {
    // Non-critical — continue without caching
  }
}

/**
 * Check if a repo URL has any cached analysis (regardless of commit SHA).
 * Returns the latest cached graph if available.
 */
export function getLatestCachedGraph(repoUrl: string): ArchGraph | null {
  try {
    const row = getDb()
      .prepare("SELECT graph_json FROM analysis_cache WHERE repo_url = ? ORDER BY created_at DESC LIMIT 1")
      .get(repoUrl) as { graph_json: string } | undefined;

    if (!row) return null;
    return JSON.parse(row.graph_json) as ArchGraph;
  } catch {
    return null;
  }
}
