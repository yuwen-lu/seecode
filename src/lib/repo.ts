import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

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

  const match = cleaned.match(
    /(?:https?:\/\/)?github\.com\/([^/]+)\/([^/.]+)/
  );
  if (!match) {
    throw new Error(
      "Invalid GitHub URL. Expected format: https://github.com/owner/repo"
    );
  }

  const owner = match[1];
  const repo = match[2];
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
    execSync(`git clone --depth 1 "${cloneUrl}" "${repoDir}"`, {
      stdio: "pipe",
      timeout: 60_000,
    });
  } catch (err) {
    // Cleanup on failure
    fs.rmSync(tmpDir, { recursive: true, force: true });
    throw new Error(
      `Failed to clone repository. Make sure it exists and is public.`
    );
  }

  let commitSha = "unknown";
  try {
    commitSha = execSync("git rev-parse HEAD", { cwd: repoDir, stdio: "pipe" })
      .toString()
      .trim();
  } catch {
    // Non-critical, continue with unknown SHA
  }

  return { repoDir, commitSha };
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
export function ingestRepo(url: string): RepoInfo {
  const { owner, repo, cloneUrl } = parseGitHubUrl(url);
  const repoName = `${owner}/${repo}`;
  const { repoDir, commitSha } = cloneRepo(cloneUrl, repo);
  const files = discoverFiles(repoDir);
  const primaryLanguage = detectPrimaryLanguage(files);

  return { repoDir, repoName, commitSha, files, primaryLanguage };
}
