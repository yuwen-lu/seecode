import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import * as tar from "tar";

/** Supported source file extensions grouped by language */
const LANGUAGE_EXTENSIONS: Record<string, string[]> = {
  typescript: [".ts", ".tsx"],
  javascript: [".js", ".jsx", ".mjs", ".cjs"],
  python: [".py"],
  go: [".go"],
  rust: [".rs"],
  swift: [".swift"],
  java: [".java"],
  kotlin: [".kt", ".kts"],
  ruby: [".rb"],
  php: [".php"],
  csharp: [".cs"],
  cpp: [".cpp", ".cc", ".cxx", ".h", ".hpp"],
  c: [".c", ".h"],
};

const ALL_SOURCE_EXTENSIONS = new Set(
  Object.values(LANGUAGE_EXTENSIONS).flat()
);

/** Directories to skip during file discovery */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "__pycache__",
  ".venv",
  "venv",
  "vendor",
  "target",
  "build",
  "dist",
  ".build",
  "Pods",
  ".gradle",
  "bin",
  "obj",
]);

export interface RepoInfo {
  repoDir: string;
  repoName: string;
  commitSha: string;
  files: SourceFile[];
  primaryLanguage: string;
}

export interface SourceFile {
  relativePath: string;
  absolutePath: string;
  extension: string;
  language: string;
}

/**
 * Parse a GitHub URL into owner/repo.
 * Supports: https://github.com/owner/repo, github.com/owner/repo,
 * https://github.com/owner/repo.git, https://github.com/owner/repo/tree/branch
 */
export function parseGitHubUrl(url: string): { owner: string; repo: string; cloneUrl: string } {
  const cleaned = url.trim().replace(/\/+$/, "");

  // Restrict owner/repo to GitHub's real identifier charset. This is a security
  // boundary, not just a UX nicety: these values flow into git invocations and
  // URLs, so anything outside [A-Za-z0-9._-] (backticks, $, |, /, …) is rejected.
  const match = cleaned.match(
    /^(?:https?:\/\/)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:\/|$)/
  );
  if (!match) {
    throw new Error(
      "Invalid GitHub URL. Expected format: https://github.com/owner/repo"
    );
  }

  const owner = match[1];
  const repo = match[2];

  // Reject path-traversal style names so repo can't escape the temp directory.
  if (owner === "." || owner === ".." || repo === "." || repo === "..") {
    throw new Error("Invalid GitHub URL. Expected format: https://github.com/owner/repo");
  }

  return {
    owner,
    repo,
    cloneUrl: `https://github.com/${owner}/${repo}.git`,
  };
}

/**
 * Clone a repo to a temp directory (shallow clone).
 * Returns the path to the cloned directory and the commit SHA.
 */
export function cloneRepo(cloneUrl: string, repoName: string): { repoDir: string; commitSha: string } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "seecode-"));
  const repoDir = path.join(tmpDir, repoName);

  try {
    // argv form (no shell) — cloneUrl/repoDir are never parsed by /bin/sh, and
    // "--" prevents a leading-dash value from being read as a git option.
    execFileSync("git", ["clone", "--depth", "1", "--", cloneUrl, repoDir], {
      stdio: "pipe",
      timeout: 60_000,
    });
  } catch (err) {
    // Cleanup on failure
    fs.rmSync(tmpDir, { recursive: true, force: true });
    const stderr = (err as { stderr?: Buffer }).stderr?.toString().trim() ?? "";
    const code = (err as { code?: string }).code;
    console.error(`git clone failed for ${cloneUrl} (code: ${code ?? "n/a"}):`, stderr || err);

    if (code === "ENOENT") {
      throw new Error("git is not available in this environment.");
    }
    if (/not found|does not exist|access denied|authentication/i.test(stderr)) {
      throw new Error("Repository not found. Make sure it exists and is public.");
    }
    throw new Error(
      `Failed to clone repository${stderr ? `: ${firstLine(stderr)}` : ". Make sure it exists and is public."}`
    );
  }

  let commitSha = "unknown";
  try {
    commitSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoDir, stdio: "pipe" })
      .toString()
      .trim();
  } catch {
    // Non-critical, continue with unknown SHA
  }

  return { repoDir, commitSha };
}

function firstLine(text: string): string {
  return text.split("\n")[0];
}

let gitAvailable: boolean | null = null;

/** Whether the git binary exists (it doesn't on Vercel serverless). Cached per process. */
export function isGitAvailable(): boolean {
  if (gitAvailable === null) {
    try {
      execFileSync("git", ["--version"], { stdio: "pipe", timeout: 10_000 });
      gitAvailable = true;
    } catch {
      gitAvailable = false;
    }
  }
  return gitAvailable;
}

function githubHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = { "User-Agent": "seecode", ...extra };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}

/**
 * Download and extract a repo's default-branch tarball from GitHub.
 * Works without the git binary (e.g. on Vercel serverless).
 */
export async function downloadRepoTarball(
  owner: string,
  repo: string,
): Promise<{ repoDir: string; commitSha: string }> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "seecode-"));

  try {
    const tarballUrl = `https://codeload.github.com/${owner}/${repo}/tar.gz/HEAD`;
    const res = await fetch(tarballUrl, { headers: githubHeaders() });

    if (res.status === 404) {
      throw new Error("Repository not found. Make sure it exists and is public.");
    }
    if (!res.ok || !res.body) {
      console.error(`Tarball download failed for ${owner}/${repo}: HTTP ${res.status}`);
      throw new Error(`Failed to download repository from GitHub (HTTP ${res.status}).`);
    }

    const tarPath = path.join(tmpDir, "repo.tar.gz");
    fs.writeFileSync(tarPath, Buffer.from(await res.arrayBuffer()));
    await tar.x({ file: tarPath, cwd: tmpDir });
    fs.rmSync(tarPath);

    // The tarball contains a single root directory (e.g. "repo-HEAD")
    const roots = fs
      .readdirSync(tmpDir, { withFileTypes: true })
      .filter((e) => e.isDirectory());
    if (roots.length !== 1) {
      throw new Error(`Unexpected tarball layout for ${owner}/${repo} (${roots.length} root dirs).`);
    }

    const repoDir = path.join(tmpDir, roots[0].name);
    const commitSha = await fetchHeadSha(owner, repo);
    return { repoDir, commitSha };
  } catch (err) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    throw err;
  }
}

/** Resolve the default branch's HEAD commit SHA via the GitHub API. */
async function fetchHeadSha(owner: string, repo: string): Promise<string> {
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits/HEAD`, {
      headers: githubHeaders({ Accept: "application/vnd.github.sha" }),
    });
    if (res.ok) return (await res.text()).trim();
    console.warn(`Could not resolve HEAD SHA for ${owner}/${repo}: HTTP ${res.status} (rate limit?)`);
  } catch (err) {
    console.warn(`Could not resolve HEAD SHA for ${owner}/${repo}:`, err);
  }
  return "unknown";
}

/**
 * Fetch a repo by whatever means the environment supports:
 * git clone when the binary exists, GitHub tarball download otherwise
 * (or when the clone fails for a reason other than a missing repo).
 */
export async function acquireRepo(
  owner: string,
  repo: string,
  cloneUrl: string,
): Promise<{ repoDir: string; commitSha: string; method: "git" | "tarball" }> {
  if (isGitAvailable()) {
    try {
      return { ...cloneRepo(cloneUrl, repo), method: "git" };
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("Repository not found")) throw err;
      console.warn(`git clone failed for ${owner}/${repo}; falling back to tarball download:`, err);
    }
  } else {
    console.warn("git is not available in this environment; using GitHub tarball download");
  }

  return { ...(await downloadRepoTarball(owner, repo)), method: "tarball" };
}

/**
 * Discover all source files in a repo directory.
 */
export function discoverFiles(repoDir: string): SourceFile[] {
  const files: SourceFile[] = [];
  walkDir(repoDir, repoDir, files);
  return files;
}

function walkDir(baseDir: string, currentDir: string, files: SourceFile[]) {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(currentDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".") continue;

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walkDir(baseDir, path.join(currentDir, entry.name), files);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (!ALL_SOURCE_EXTENSIONS.has(ext)) continue;

      const absolutePath = path.join(currentDir, entry.name);
      const relativePath = path.relative(baseDir, absolutePath);
      const language = detectLanguage(ext);

      files.push({ relativePath, absolutePath, extension: ext, language });
    }
  }
}

function detectLanguage(ext: string): string {
  for (const [lang, exts] of Object.entries(LANGUAGE_EXTENSIONS)) {
    if (exts.includes(ext)) return lang;
  }
  return "unknown";
}

/**
 * Determine the primary language of a repo based on file counts.
 */
export function detectPrimaryLanguage(files: SourceFile[]): string {
  const counts: Record<string, number> = {};
  for (const f of files) {
    counts[f.language] = (counts[f.language] || 0) + 1;
  }

  let maxLang = "unknown";
  let maxCount = 0;
  for (const [lang, count] of Object.entries(counts)) {
    if (count > maxCount) {
      maxLang = lang;
      maxCount = count;
    }
  }
  return maxLang;
}

/**
 * Clean up a cloned repo directory.
 */
export function cleanupRepo(repoDir: string) {
  try {
    // Go up one level to remove the temp dir container
    const parentDir = path.dirname(repoDir);
    if (parentDir.includes("seecode-")) {
      fs.rmSync(parentDir, { recursive: true, force: true });
    }
  } catch {
    // Best effort cleanup
  }
}

/**
 * Full repo ingestion: parse URL, clone, discover files, detect language.
 */
export async function ingestRepo(url: string): Promise<RepoInfo> {
  const { owner, repo, cloneUrl } = parseGitHubUrl(url);
  const repoName = `${owner}/${repo}`;
  const { repoDir, commitSha } = await acquireRepo(owner, repo, cloneUrl);
  const files = discoverFiles(repoDir);
  const primaryLanguage = detectPrimaryLanguage(files);

  return { repoDir, repoName, commitSha, files, primaryLanguage };
}
