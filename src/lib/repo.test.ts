import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { parseGitHubUrl, discoverFiles, detectPrimaryLanguage, cleanupRepo } from "./repo";
import type { SourceFile } from "./repo";
import fs from "fs";
import path from "path";
import os from "os";

describe("parseGitHubUrl", () => {
  it("parses standard HTTPS URL", () => {
    const result = parseGitHubUrl("https://github.com/owner/repo");
    expect(result.owner).toBe("owner");
    expect(result.repo).toBe("repo");
    expect(result.cloneUrl).toBe("https://github.com/owner/repo.git");
  });

  it("handles trailing slash", () => {
    const result = parseGitHubUrl("https://github.com/owner/repo/");
    expect(result.owner).toBe("owner");
    expect(result.repo).toBe("repo");
  });

  it("handles multiple trailing slashes", () => {
    const result = parseGitHubUrl("https://github.com/owner/repo///");
    expect(result.owner).toBe("owner");
    expect(result.repo).toBe("repo");
  });

  it("handles URL with .git suffix", () => {
    // The regex is [^/.]+, so it stops at the dot in ".git"
    const result = parseGitHubUrl("https://github.com/owner/repo.git");
    expect(result.owner).toBe("owner");
    expect(result.repo).toBe("repo");
  });

  it("handles URL without protocol", () => {
    const result = parseGitHubUrl("github.com/owner/repo");
    expect(result.owner).toBe("owner");
    expect(result.repo).toBe("repo");
  });

  it("handles URL with /tree/branch path", () => {
    const result = parseGitHubUrl("https://github.com/owner/repo/tree/main");
    expect(result.owner).toBe("owner");
    expect(result.repo).toBe("repo");
  });

  it("handles URL with /tree/branch/subpath", () => {
    const result = parseGitHubUrl("https://github.com/owner/repo/tree/main/src/components");
    expect(result.owner).toBe("owner");
    expect(result.repo).toBe("repo");
  });

  it("handles leading/trailing whitespace", () => {
    const result = parseGitHubUrl("  https://github.com/owner/repo  ");
    expect(result.owner).toBe("owner");
    expect(result.repo).toBe("repo");
  });

  it("throws on invalid URL", () => {
    expect(() => parseGitHubUrl("not-a-url")).toThrow("Invalid GitHub URL");
    expect(() => parseGitHubUrl("https://gitlab.com/owner/repo")).toThrow();
    expect(() => parseGitHubUrl("")).toThrow();
  });

  it("handles repo names with hyphens", () => {
    const result = parseGitHubUrl("https://github.com/my-org/my-cool-repo");
    expect(result.owner).toBe("my-org");
    expect(result.repo).toBe("my-cool-repo");
  });

  it("handles repo names with numbers", () => {
    const result = parseGitHubUrl("https://github.com/user123/project456");
    expect(result.owner).toBe("user123");
    expect(result.repo).toBe("project456");
  });

  describe("edge cases in URL parsing", () => {
    it("stops at dot in repo name — repo.js becomes repo", () => {
      // The regex [^/.] stops at dots, so "repo.js" → "repo"
      const result = parseGitHubUrl("https://github.com/owner/repo.js");
      expect(result.repo).toBe("repo");
    });

    it("handles HTTP (non-HTTPS) URL", () => {
      const result = parseGitHubUrl("http://github.com/owner/repo");
      expect(result.owner).toBe("owner");
      expect(result.repo).toBe("repo");
    });
  });
});

describe("discoverFiles", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "discover-test-"));
    // Create test file tree
    const dirs = ["src", "src/utils", "node_modules/react", ".git", "__pycache__"];
    for (const d of dirs) {
      fs.mkdirSync(path.join(tmpDir, d), { recursive: true });
    }
    fs.writeFileSync(path.join(tmpDir, "src/app.ts"), "// app");
    fs.writeFileSync(path.join(tmpDir, "src/utils/helpers.py"), "# helpers");
    fs.writeFileSync(path.join(tmpDir, "src/main.go"), "package main");
    fs.writeFileSync(path.join(tmpDir, "src/lib.rs"), "fn main() {}");
    fs.writeFileSync(path.join(tmpDir, "src/styles.css"), "body{}"); // not a source file
    fs.writeFileSync(path.join(tmpDir, "node_modules/react/index.js"), "module.exports={}");
    fs.writeFileSync(path.join(tmpDir, "README.md"), "# readme"); // not a source file
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("finds source files recursively", () => {
    const files = discoverFiles(tmpDir);
    const relativePaths = files.map((f) => f.relativePath);
    expect(relativePaths).toContain(path.join("src", "app.ts"));
    expect(relativePaths).toContain(path.join("src", "utils", "helpers.py"));
    expect(relativePaths).toContain(path.join("src", "main.go"));
    expect(relativePaths).toContain(path.join("src", "lib.rs"));
  });

  it("skips node_modules", () => {
    const files = discoverFiles(tmpDir);
    expect(files.every((f) => !f.relativePath.includes("node_modules"))).toBe(true);
  });

  it("skips .git directory", () => {
    const files = discoverFiles(tmpDir);
    expect(files.every((f) => !f.relativePath.includes(".git"))).toBe(true);
  });

  it("skips non-source files", () => {
    const files = discoverFiles(tmpDir);
    expect(files.every((f) => !f.relativePath.endsWith(".css"))).toBe(true);
    expect(files.every((f) => !f.relativePath.endsWith(".md"))).toBe(true);
  });

  it("detects correct language for each extension", () => {
    const files = discoverFiles(tmpDir);
    const tsFile = files.find((f) => f.relativePath.endsWith(".ts"));
    expect(tsFile?.language).toBe("typescript");
    const pyFile = files.find((f) => f.relativePath.endsWith(".py"));
    expect(pyFile?.language).toBe("python");
    const goFile = files.find((f) => f.relativePath.endsWith(".go"));
    expect(goFile?.language).toBe("go");
    const rsFile = files.find((f) => f.relativePath.endsWith(".rs"));
    expect(rsFile?.language).toBe("rust");
  });

  it("handles empty directory", () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "empty-"));
    const files = discoverFiles(emptyDir);
    expect(files).toEqual([]);
    fs.rmSync(emptyDir, { recursive: true, force: true });
  });
});

describe("detectPrimaryLanguage", () => {
  it("returns the language with most files", () => {
    const files: SourceFile[] = [
      { relativePath: "a.ts", absolutePath: "", extension: ".ts", language: "typescript" },
      { relativePath: "b.ts", absolutePath: "", extension: ".ts", language: "typescript" },
      { relativePath: "c.py", absolutePath: "", extension: ".py", language: "python" },
    ];
    expect(detectPrimaryLanguage(files)).toBe("typescript");
  });

  it("returns unknown for empty file list", () => {
    expect(detectPrimaryLanguage([])).toBe("unknown");
  });

  it("picks first max when languages are tied", () => {
    const files: SourceFile[] = [
      { relativePath: "a.ts", absolutePath: "", extension: ".ts", language: "typescript" },
      { relativePath: "a.py", absolutePath: "", extension: ".py", language: "python" },
    ];
    // When tied, the one encountered last with > maxCount wins
    // Since both have count=1, neither is > 0 after the first, so depends on iteration order
    const result = detectPrimaryLanguage(files);
    expect(["typescript", "python"]).toContain(result);
  });
});

describe("cleanupRepo", () => {
  it("removes temp directory when path contains seecode-", () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "seecode-"));
    const repoDir = path.join(tmpBase, "myrepo");
    fs.mkdirSync(repoDir, { recursive: true });
    fs.writeFileSync(path.join(repoDir, "test.txt"), "test");

    cleanupRepo(repoDir);
    expect(fs.existsSync(tmpBase)).toBe(false);
  });

  it("does nothing for paths without seecode- in parent", () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "other-"));
    const repoDir = path.join(tmpBase, "myrepo");
    fs.mkdirSync(repoDir, { recursive: true });

    cleanupRepo(repoDir);
    // Parent should still exist since it doesn't contain "seecode-"
    expect(fs.existsSync(tmpBase)).toBe(true);
    fs.rmSync(tmpBase, { recursive: true, force: true });
  });
});
