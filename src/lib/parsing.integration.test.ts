/**
 * Integration tests: run the full deterministic pipeline
 * (clone → discover → tree-sitter extract → AST analyze) against a list of
 * popular open-source repositories and assert the graph invariants hold.
 *
 * These tests hit the network, so they are skipped unless explicitly enabled:
 *
 *   npm run test:integration
 */
import { describe, it, expect, afterAll } from "vitest";
import { execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { discoverFiles, detectPrimaryLanguage, downloadRepoTarball, acquireRepo } from "./repo";
import { extractAll, TREE_SITTER_LANGUAGES } from "./extractors";
import { analyzeWithAST } from "./ast-analyzer";

const enabled = process.env.SEECODE_INTEGRATION === "1";

interface RepoCase {
  repo: string;
  language: string;
  /** Minimum fraction of tree-sitter-language files that must parse. */
  minCoverage: number;
}

const REPOS: RepoCase[] = [
  { repo: "expressjs/express", language: "javascript", minCoverage: 0.9 },
  { repo: "axios/axios", language: "javascript", minCoverage: 0.9 },
  { repo: "pmndrs/zustand", language: "typescript", minCoverage: 0.9 },
  { repo: "honojs/hono", language: "typescript", minCoverage: 0.9 },
  { repo: "pallets/flask", language: "python", minCoverage: 0.9 },
  { repo: "gin-gonic/gin", language: "go", minCoverage: 0.9 },
  { repo: "tokio-rs/bytes", language: "rust", minCoverage: 0.9 },
];

const cloneDirs: string[] = [];

afterAll(() => {
  for (const dir of cloneDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function cloneShallow(repo: string): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "seecode-integration-"));
  cloneDirs.push(tmpDir);
  const repoDir = path.join(tmpDir, repo.split("/")[1]);
  execSync(`git clone --depth 1 "https://github.com/${repo}.git" "${repoDir}"`, {
    stdio: "pipe",
    timeout: 120_000,
  });
  return repoDir;
}

describe.skipIf(!enabled)("AST parsing against popular open-source repos", () => {
  it.each(REPOS)(
    "produces a valid deterministic graph for $repo",
    ({ repo, language, minCoverage }) => {
      const repoDir = cloneShallow(repo);
      const files = discoverFiles(repoDir);

      expect(files.length).toBeGreaterThan(0);
      expect(detectPrimaryLanguage(files)).toBe(language);

      // Tree-sitter must parse nearly all files in supported languages
      const parseable = files.filter((f) => TREE_SITTER_LANGUAGES.has(f.language));
      const extraction = extractAll(files);
      expect(extraction.files.length).toBeGreaterThanOrEqual(
        Math.floor(parseable.length * minCoverage),
      );

      const result = analyzeWithAST(extraction, files);

      // Modules exist and have well-formed required fields
      expect(result.modules.length).toBeGreaterThan(0);
      for (const mod of result.modules) {
        expect(mod.id).toBeTruthy();
        expect(mod.name).toBeTruthy();
        expect(mod.responsibility).toBeTruthy();
        expect([
          "core", "api-client", "data", "visual", "utility", "config", "external", "proxy", "voice",
        ]).toContain(mod.category);
      }

      // Module ids are unique
      const ids = result.modules.map((m) => m.id);
      expect(new Set(ids).size).toBe(ids.length);

      // Every discovered file is assigned to exactly one module
      const assigned = result.modules.flatMap((m) => m.files).sort();
      const discovered = files.map((f) => f.relativePath).sort();
      expect(assigned).toEqual(discovered);

      // Edges connect existing modules and never self-loop
      const idSet = new Set(ids);
      for (const edge of result.edges) {
        expect(idSet.has(edge.from)).toBe(true);
        expect(idSet.has(edge.to)).toBe(true);
        expect(edge.from).not.toBe(edge.to);
        expect(["owns", "depends", "dataflow", "weak"]).toContain(edge.type);
      }

      // The whole graph is deterministic across runs
      const second = analyzeWithAST(extractAll(files), files);
      expect(JSON.stringify(second)).toBe(JSON.stringify(result));
    },
    180_000,
  );
});

// Vercel serverless has no git binary; the tarball download path is what
// production uses. Run the full pipeline through it.
describe.skipIf(!enabled)("repo acquisition without git (serverless path)", () => {
  it("downloads a tarball and runs the full pipeline on it", async () => {
    const { repoDir, commitSha } = await downloadRepoTarball("tokio-rs", "bytes");
    cloneDirs.push(path.dirname(repoDir));

    expect(commitSha).toMatch(/^([0-9a-f]{40}|unknown)$/);

    const files = discoverFiles(repoDir);
    expect(files.length).toBeGreaterThan(0);
    expect(detectPrimaryLanguage(files)).toBe("rust");

    const result = analyzeWithAST(extractAll(files), files);
    expect(result.modules.length).toBeGreaterThan(0);
    expect(result.modules.flatMap((m) => m.files).sort())
      .toEqual(files.map((f) => f.relativePath).sort());
  }, 180_000);

  it("reports a clear error for nonexistent repos", async () => {
    await expect(downloadRepoTarball("yuwen-lu", "this-repo-does-not-exist-xyz"))
      .rejects.toThrow(/Repository not found/);
  }, 60_000);

  it("acquireRepo returns a usable repo regardless of fetch method", async () => {
    const { repoDir, method } = await acquireRepo(
      "pmndrs",
      "zustand",
      "https://github.com/pmndrs/zustand.git",
    );
    cloneDirs.push(path.dirname(repoDir));

    expect(["git", "tarball"]).toContain(method);
    expect(discoverFiles(repoDir).length).toBeGreaterThan(0);
  }, 180_000);
});
