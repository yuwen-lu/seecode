import { describe, it, expect } from "vitest";
import { githubRawUrl, getCategoryColors, CATEGORY_LABELS } from "./graph";
import type { NodeCategory } from "./graph";

describe("githubRawUrl", () => {
  it("builds correct raw URL from standard repo URL", () => {
    const url = githubRawUrl(
      "https://github.com/owner/repo",
      "abc123",
      "src/app.ts",
    );
    expect(url).toBe("https://raw.githubusercontent.com/owner/repo/abc123/src/app.ts");
  });

  it("handles repo URL with .git suffix", () => {
    const url = githubRawUrl(
      "https://github.com/owner/repo.git",
      "sha456",
      "README.md",
    );
    // The regex [^/.] stops at dot, so "repo.git" → "repo"
    expect(url).toBe("https://raw.githubusercontent.com/owner/repo/sha456/README.md");
  });

  it("returns empty string for non-GitHub URL", () => {
    const url = githubRawUrl("https://gitlab.com/owner/repo", "sha", "file.ts");
    expect(url).toBe("");
  });

  it("handles files in nested directories", () => {
    const url = githubRawUrl(
      "https://github.com/owner/repo",
      "sha",
      "src/deeply/nested/file.ts",
    );
    expect(url).toContain("src/deeply/nested/file.ts");
  });

  it("handles file paths with spaces (edge case)", () => {
    const url = githubRawUrl(
      "https://github.com/owner/repo",
      "sha",
      "src/my file.ts",
    );
    expect(url).toContain("my file.ts");
  });
});

describe("getCategoryColors", () => {
  const allCategories: NodeCategory[] = [
    "core", "voice", "visual", "api-client", "proxy",
    "external", "utility", "data", "config",
  ];

  it("returns dark colors when isDark is true", () => {
    const colors = getCategoryColors(true);
    for (const cat of allCategories) {
      expect(colors[cat]).toBeDefined();
      expect(colors[cat].bg).toBeDefined();
      expect(colors[cat].border).toBeDefined();
      expect(colors[cat].text).toBeDefined();
    }
  });

  it("returns light colors when isDark is false", () => {
    const colors = getCategoryColors(false);
    for (const cat of allCategories) {
      expect(colors[cat]).toBeDefined();
    }
  });

  it("dark and light palettes are different", () => {
    const dark = getCategoryColors(true);
    const light = getCategoryColors(false);
    // At least for core, the background should differ
    expect(dark.core.bg).not.toBe(light.core.bg);
  });
});

describe("CATEGORY_LABELS", () => {
  it("has labels for all NodeCategory values", () => {
    const expectedCategories: NodeCategory[] = [
      "core", "voice", "visual", "api-client", "proxy",
      "external", "utility", "data", "config",
    ];
    for (const cat of expectedCategories) {
      expect(CATEGORY_LABELS[cat]).toBeDefined();
      expect(typeof CATEGORY_LABELS[cat]).toBe("string");
      expect(CATEGORY_LABELS[cat].length).toBeGreaterThan(0);
    }
  });
});
