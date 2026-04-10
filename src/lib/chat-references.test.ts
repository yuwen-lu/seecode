import { describe, it, expect } from "vitest";
import { buildFileIndex } from "./chat-references";
import type { ArchModule, NodeCategory } from "@/types/graph";

function makeModule(id: string, category: NodeCategory, files: string[]): ArchModule {
  return {
    id, name: id, files, category,
    responsibility: "", keyTypes: [], keyMethods: [],
  };
}

describe("buildFileIndex", () => {
  it("maps each file to its module", () => {
    const modules = [
      makeModule("auth", "core", ["src/auth.ts", "src/auth-utils.ts"]),
      makeModule("db", "data", ["src/db.ts"]),
    ];
    const index = buildFileIndex(modules);
    expect(index.size).toBe(3);
    expect(index.get("src/auth.ts")?.moduleId).toBe("auth");
    expect(index.get("src/db.ts")?.moduleId).toBe("db");
  });

  it("returns empty map for empty modules", () => {
    const index = buildFileIndex([]);
    expect(index.size).toBe(0);
  });

  it("returns empty map for modules with no files", () => {
    const modules = [makeModule("empty", "utility", [])];
    const index = buildFileIndex(modules);
    expect(index.size).toBe(0);
  });

  it("last module wins when same file appears in multiple modules", () => {
    // This is a real scenario if the LLM assigns a file to multiple modules
    const modules = [
      makeModule("auth", "core", ["src/shared.ts"]),
      makeModule("db", "data", ["src/shared.ts"]),
    ];
    const index = buildFileIndex(modules);
    expect(index.size).toBe(1);
    // Map.set overwrites, so the last one wins
    expect(index.get("src/shared.ts")?.moduleId).toBe("db");
  });

  it("preserves category in the index entry", () => {
    const modules = [makeModule("auth", "core", ["src/auth.ts"])];
    const index = buildFileIndex(modules);
    expect(index.get("src/auth.ts")?.category).toBe("core");
    expect(index.get("src/auth.ts")?.moduleName).toBe("auth");
  });
});
