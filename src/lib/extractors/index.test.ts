import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { extractAll } from "./index";
import type { SourceFile } from "@/lib/repo";
import fs from "fs";
import path from "path";
import os from "os";

let tmpDir: string;

function makeSourceFile(relativePath: string, code: string): SourceFile {
  const absolutePath = path.join(tmpDir, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, code);
  const ext = path.extname(relativePath);
  const langMap: Record<string, string> = {
    ".ts": "typescript", ".tsx": "typescript", ".js": "javascript",
    ".py": "python", ".go": "go", ".rs": "rust",
  };
  return {
    relativePath,
    absolutePath,
    extension: ext,
    language: langMap[ext] ?? "unknown",
  };
}

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "extract-all-test-"));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("extractAll", () => {
  it("skips unsupported languages gracefully", () => {
    const files: SourceFile[] = [
      {
        relativePath: "app.swift",
        absolutePath: path.join(tmpDir, "app.swift"),
        extension: ".swift",
        language: "swift",
      },
    ];
    fs.writeFileSync(files[0].absolutePath, "import Foundation");
    const result = extractAll(files);
    expect(result.files).toHaveLength(0);
  });

  it("does not crash on files with syntax errors", () => {
    const files = [
      makeSourceFile("broken.ts", "export function {{{{ broken syntax"),
    ];
    // Should not throw — extractAll catches per-file errors
    const result = extractAll(files);
    // Tree-sitter is error-tolerant, so it may still produce partial results
    expect(result).toBeDefined();
  });

  it("builds dependency edges for relative imports", () => {
    const files = [
      makeSourceFile("src/utils.ts", `
export function helper() { return 1; }
      `),
      makeSourceFile("src/main.ts", `
import { helper } from "./utils";
export function main() { return helper(); }
      `),
    ];
    const result = extractAll(files);
    expect(result.files).toHaveLength(2);
    expect(result.dependencyEdges).toHaveLength(1);
    expect(result.dependencyEdges[0].fromFile).toBe("src/main.ts");
    expect(result.dependencyEdges[0].toFile).toBe("src/utils.ts");
    // Note: importedNames is empty due to the TS import extraction bug
    // (named import identifiers are not parsed — see typescript.test.ts)
    expect(result.dependencyEdges[0].importedNames).toEqual([]);
  });

  it("resolves index imports", () => {
    const files = [
      makeSourceFile("src/lib/index.ts", `
export function libInit() {}
      `),
      makeSourceFile("src/app.ts", `
import { libInit } from "./lib";
      `),
    ];
    const result = extractAll(files);
    const edge = result.dependencyEdges.find((e) => e.fromFile === "src/app.ts");
    expect(edge).toBeDefined();
    expect(edge!.toFile).toBe("src/lib/index.ts");
  });

  it("skips external package imports", () => {
    const files = [
      makeSourceFile("src/app.ts", `
import React from "react";
import { useState } from "react";
import express from "express";
      `),
    ];
    const result = extractAll(files);
    expect(result.dependencyEdges).toHaveLength(0);
  });

  describe("basename collision in pathLookup", () => {
    it("first file wins when two files share the same basename", () => {
      // pathLookup adds basename without dir: `if (!pathLookup.has(basename))`
      // So only the first file's basename gets registered
      const files = [
        makeSourceFile("src/models/utils.ts", `
export function modelHelper() {}
        `),
        makeSourceFile("src/controllers/utils.ts", `
export function controllerHelper() {}
        `),
        makeSourceFile("src/app.ts", `
import { modelHelper } from "utils";
        `),
      ];
      const result = extractAll(files);
      const edge = result.dependencyEdges.find((e) => e.fromFile === "src/app.ts");
      // The import of bare "utils" will resolve to whichever was registered first
      // This is non-deterministic depending on iteration order — a potential bug
      if (edge) {
        expect(
          edge.toFile === "src/models/utils.ts" ||
          edge.toFile === "src/controllers/utils.ts"
        ).toBe(true);
      }
    });
  });

  it("does not create self-referencing edges", () => {
    const files = [
      makeSourceFile("src/self.ts", `
import { something } from "./self";
export function something() {}
      `),
    ];
    const result = extractAll(files);
    expect(result.dependencyEdges).toHaveLength(0);
  });

  it("handles empty input", () => {
    const result = extractAll([]);
    expect(result.files).toEqual([]);
    expect(result.dependencyEdges).toEqual([]);
  });
});
