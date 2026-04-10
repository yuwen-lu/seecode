import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { enrichModulesWithFiles } from "./llm-analyzer";
import type { ArchModule } from "@/types/graph";
import type { ExtractionResult } from "./extractors";
import type { SourceFile } from "./repo";
import fs from "fs";
import path from "path";
import os from "os";

let tmpDir: string;

function makeSourceFile(relativePath: string, content: string): SourceFile {
  const absolutePath = path.join(tmpDir, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content);
  return {
    relativePath,
    absolutePath,
    extension: path.extname(relativePath),
    language: "typescript",
  };
}

function makeModule(overrides: Partial<ArchModule> & { id: string; name: string }): ArchModule {
  return {
    files: [],
    category: "core",
    responsibility: "does stuff",
    keyTypes: [],
    keyMethods: [],
    ...overrides,
  };
}

function makeExtraction(files: ExtractionResult["files"]): ExtractionResult {
  return { files, dependencyEdges: [] };
}

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "enrich-test-"));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("enrichModulesWithFiles", () => {
  describe("LLM-provided files validation", () => {
    it("keeps LLM files that match source files exactly", () => {
      const sf = makeSourceFile("src/auth.ts", "export class Auth {}");
      const mod = makeModule({
        id: "auth", name: "Auth", files: ["src/auth.ts"],
      });
      enrichModulesWithFiles([mod], makeExtraction([]), [sf]);
      expect(mod.files).toEqual(["src/auth.ts"]);
    });

    it("resolves partial paths via /filename suffix matching", () => {
      const sf = makeSourceFile("src/deep/nested/auth.ts", "export class Auth {}");
      const mod = makeModule({
        id: "auth", name: "Auth", files: ["auth.ts"],
      });
      enrichModulesWithFiles([mod], makeExtraction([]), [sf]);
      expect(mod.files).toEqual(["src/deep/nested/auth.ts"]);
    });

    it("does not produce false positives — 'bar.ts' does not match 'foobar.ts'", () => {
      const sf1 = makeSourceFile("src/foobar.ts", "export function foobar() {}");
      const sf2 = makeSourceFile("src/bar.ts", "export function bar() {}");
      const mod = makeModule({
        id: "bar-mod", name: "Bar", files: ["bar.ts"],
      });
      enrichModulesWithFiles([mod], makeExtraction([]), [sf1, sf2]);
      expect(mod.files).toEqual(["src/bar.ts"]);
    });

    it("drops LLM files that don't exist in source at all", () => {
      const sf = makeSourceFile("src/real.ts", "const x = 1;");
      const mod = makeModule({
        id: "mod", name: "Mod",
        files: ["src/ghost.ts", "src/phantom.ts"],
      });
      const extraction = makeExtraction([{
        filePath: "src/real.ts",
        language: "typescript",
        classes: [], functions: [{ name: "Mod", params: [] }],
        imports: [], exports: ["Mod"],
      }]);
      enrichModulesWithFiles([mod], extraction, [sf]);
      expect(mod.files).not.toContain("src/ghost.ts");
    });

    it("computes lineCount from resolved files when LLM doesn't provide it", () => {
      const sf = makeSourceFile("src/counter.ts", "line1\nline2\nline3\n");
      const mod = makeModule({
        id: "counter", name: "Counter", files: ["src/counter.ts"],
      });
      enrichModulesWithFiles([mod], makeExtraction([]), [sf]);
      expect(mod.lineCount).toBe(4);
    });

    it("preserves existing lineCount when LLM already set it", () => {
      const sf = makeSourceFile("src/keep.ts", "a\nb\nc");
      const mod = makeModule({
        id: "keep", name: "Keep", files: ["src/keep.ts"], lineCount: 999,
      });
      enrichModulesWithFiles([mod], makeExtraction([]), [sf]);
      expect(mod.lineCount).toBe(999);
    });
  });

  describe("symbol-based matching", () => {
    it("matches module to file by class name overlap", () => {
      const sf = makeSourceFile("src/auth-service.ts", "export class AuthService {}");
      const extraction = makeExtraction([{
        filePath: "src/auth-service.ts",
        language: "typescript",
        classes: [{ name: "AuthService", methods: [], properties: [] }],
        functions: [], imports: [], exports: ["AuthService"],
      }]);
      const mod = makeModule({
        id: "auth", name: "Auth",
        keyTypes: ["AuthService"],
      });
      enrichModulesWithFiles([mod], extraction, [sf]);
      expect(mod.files).toContain("src/auth-service.ts");
    });

    it("matches by filename containing module name", () => {
      const sf = makeSourceFile("src/auth.ts", "const x = 1;");
      const extraction = makeExtraction([{
        filePath: "src/auth.ts",
        language: "typescript",
        classes: [], functions: [], imports: [], exports: [],
      }]);
      const mod = makeModule({ id: "auth", name: "Auth" });
      enrichModulesWithFiles([mod], extraction, [sf]);
      expect(mod.files).toContain("src/auth.ts");
    });

    it("matches by keyMethod name (strips parens)", () => {
      const sf = makeSourceFile("src/utils.ts", "export function compute() {}");
      const extraction = makeExtraction([{
        filePath: "src/utils.ts",
        language: "typescript",
        classes: [],
        functions: [{ name: "compute", params: [] }],
        imports: [], exports: ["compute"],
      }]);
      const mod = makeModule({
        id: "calc", name: "Calculator",
        keyMethods: ["compute()"],
      });
      enrichModulesWithFiles([mod], extraction, [sf]);
      expect(mod.files).toContain("src/utils.ts");
    });

    it("strips hyphens from module id for matching", () => {
      const sf = makeSourceFile("src/apiclients.ts", "const x = 1;");
      const extraction = makeExtraction([{
        filePath: "src/apiclients.ts",
        language: "typescript",
        classes: [], functions: [], imports: [], exports: [],
      }]);
      const mod = makeModule({ id: "api-clients", name: "API Clients" });
      enrichModulesWithFiles([mod], extraction, [sf]);
      expect(mod.files).toContain("src/apiclients.ts");
    });

    it("matching is case-insensitive", () => {
      const sf = makeSourceFile("src/UserStore.ts", "export class UserStore {}");
      const extraction = makeExtraction([{
        filePath: "src/UserStore.ts",
        language: "typescript",
        classes: [{ name: "UserStore", methods: [], properties: [] }],
        functions: [], imports: [], exports: ["UserStore"],
      }]);
      const mod = makeModule({
        id: "users", name: "users",
        keyTypes: ["userstore"],
      });
      enrichModulesWithFiles([mod], extraction, [sf]);
      expect(mod.files).toContain("src/UserStore.ts");
    });
  });

  describe("file assignment exclusivity", () => {
    it("files assigned to first module are not available to later modules", () => {
      const sf = makeSourceFile("src/shared.ts", "export function shared() {}");
      const extraction = makeExtraction([{
        filePath: "src/shared.ts",
        language: "typescript",
        classes: [],
        functions: [{ name: "shared", params: [] }],
        imports: [], exports: ["shared"],
      }]);
      const mod1 = makeModule({ id: "shared", name: "Shared" });
      const mod2 = makeModule({
        id: "other", name: "Other", keyTypes: ["shared"],
      });
      enrichModulesWithFiles([mod1, mod2], extraction, [sf]);
      expect(mod1.files).toContain("src/shared.ts");
      expect(mod2.files).not.toContain("src/shared.ts");
    });

    it("resolved LLM paths prevent double assignment via symbol matching", () => {
      const sf = makeSourceFile("src/db.ts", "export class Database {}");
      const extraction = makeExtraction([{
        filePath: "src/db.ts",
        language: "typescript",
        classes: [{ name: "Database", methods: [], properties: [] }],
        functions: [], imports: [], exports: ["Database"],
      }]);
      const mod1 = makeModule({
        id: "data", name: "Data Layer", files: ["db.ts"],
      });
      const mod2 = makeModule({
        id: "orm", name: "ORM", keyTypes: ["Database"],
      });
      enrichModulesWithFiles([mod1, mod2], extraction, [sf]);
      expect(mod1.files).toEqual(["src/db.ts"]);
      expect(mod2.files).not.toContain("src/db.ts");
    });
  });

  describe("unassigned files dump to utility/config", () => {
    it("dumps leftover files into the utility module", () => {
      const sf1 = makeSourceFile("src/orphan.ts", "const x = 1;");
      const sf2 = makeSourceFile("src/helpers.ts", "const y = 2;");
      const extraction = makeExtraction([{
        filePath: "src/orphan.ts",
        language: "typescript",
        classes: [], functions: [], imports: [], exports: [],
      }]);
      const utilMod = makeModule({
        id: "utils", name: "Utilities", category: "utility",
      });
      enrichModulesWithFiles([utilMod], extraction, [sf1, sf2]);
      expect(utilMod.files).toContain("src/orphan.ts");
      expect(utilMod.files).toContain("src/helpers.ts");
    });

    it("uses config module if no utility module exists", () => {
      const sf = makeSourceFile("src/stray.ts", "const z = 3;");
      const extraction = makeExtraction([]);
      const configMod = makeModule({
        id: "config", name: "Config", category: "config",
      });
      enrichModulesWithFiles([configMod], extraction, [sf]);
      expect(configMod.files).toContain("src/stray.ts");
    });

    it("orphan files are silently lost if no utility or config module exists", () => {
      const sf = makeSourceFile("src/lost.ts", "const gone = true;");
      const extraction = makeExtraction([]);
      const coreMod = makeModule({
        id: "core", name: "Core", category: "core",
      });
      enrichModulesWithFiles([coreMod], extraction, [sf]);
      expect(coreMod.files).not.toContain("src/lost.ts");
    });
  });

  describe("edge cases", () => {
    it("handles empty modules array", () => {
      const sf = makeSourceFile("src/empty.ts", "const x = 1;");
      const extraction = makeExtraction([]);
      expect(() => enrichModulesWithFiles([], extraction, [sf])).not.toThrow();
    });

    it("handles empty source files", () => {
      const mod = makeModule({ id: "mod", name: "Mod" });
      expect(() => enrichModulesWithFiles([mod], makeExtraction([]), [])).not.toThrow();
      expect(mod.files).toEqual([]);
    });

    it("handles module with empty keyMethods and keyTypes", () => {
      const sf = makeSourceFile("src/plain.ts", "const x = 1;");
      const extraction = makeExtraction([{
        filePath: "src/plain.ts",
        language: "typescript",
        classes: [], functions: [], imports: [], exports: [],
      }]);
      const mod = makeModule({
        id: "something-else", name: "Unrelated",
        keyTypes: [], keyMethods: [],
      });
      enrichModulesWithFiles([mod], extraction, [sf]);
    });

    it("accumulates lineCount for unassigned files added to utility", () => {
      const sf1 = makeSourceFile("src/a.ts", "1\n2\n3");
      const sf2 = makeSourceFile("src/b.ts", "1\n2\n3\n4\n5");
      const extraction = makeExtraction([]);
      const utilMod = makeModule({
        id: "utils", name: "Utilities", category: "utility",
      });
      enrichModulesWithFiles([utilMod], extraction, [sf1, sf2]);
      expect(utilMod.lineCount).toBe(3 + 5);
    });
  });
});
