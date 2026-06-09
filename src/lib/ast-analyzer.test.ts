import { describe, it, expect } from "vitest";
import { analyzeWithAST, canAnalyzeWithAST } from "./ast-analyzer";
import type { ExtractionResult, ExtractedFile } from "./extractors";
import type { SourceFile } from "./repo";

function srcFile(relativePath: string): SourceFile {
  const ext = relativePath.slice(relativePath.lastIndexOf("."));
  return {
    relativePath,
    absolutePath: `/nonexistent/${relativePath}`,
    extension: ext,
    language: ext === ".tsx" ? "typescript" : "typescript",
  };
}

function extracted(overrides: Partial<ExtractedFile> & { filePath: string }): ExtractedFile {
  return {
    language: "typescript",
    classes: [],
    functions: [],
    imports: [],
    exports: [],
    ...overrides,
  };
}

const emptyExtraction: ExtractionResult = { files: [], dependencyEdges: [] };

describe("canAnalyzeWithAST", () => {
  it("supports every tree-sitter language", () => {
    expect(canAnalyzeWithAST("typescript")).toBe(true);
    expect(canAnalyzeWithAST("javascript")).toBe(true);
    expect(canAnalyzeWithAST("python")).toBe(true);
    expect(canAnalyzeWithAST("go")).toBe(true);
    expect(canAnalyzeWithAST("rust")).toBe(true);
  });

  it("rejects languages without an extractor", () => {
    expect(canAnalyzeWithAST("swift")).toBe(false);
    expect(canAnalyzeWithAST("java")).toBe(false);
    expect(canAnalyzeWithAST("unknown")).toBe(false);
  });
});

describe("analyzeWithAST — module grouping", () => {
  it("groups files by directory", () => {
    const files = [
      srcFile("src/lib/cache.ts"),
      srcFile("src/lib/repo.ts"),
      srcFile("src/components/Header.tsx"),
      srcFile("src/components/Panel.tsx"),
    ];

    const { modules } = analyzeWithAST(emptyExtraction, files);

    expect(modules).toHaveLength(2);
    const ids = modules.map((m) => m.id).sort();
    expect(ids).toEqual(["components", "lib"]);

    const lib = modules.find((m) => m.id === "lib")!;
    expect(lib.files.sort()).toEqual(["src/lib/cache.ts", "src/lib/repo.ts"]);
  });

  it("merges small sibling directories into their shared parent", () => {
    const files = [
      srcFile("src/app/api/analyze/route.ts"),
      srcFile("src/app/api/chat/route.ts"),
      srcFile("src/lib/a.ts"),
      srcFile("src/lib/b.ts"),
    ];

    const { modules } = analyzeWithAST(emptyExtraction, files);
    const api = modules.find((m) => m.id === "app-api");

    expect(api).toBeDefined();
    expect(api!.files.sort()).toEqual([
      "src/app/api/analyze/route.ts",
      "src/app/api/chat/route.ts",
    ]);
  });

  it("merges a single-file directory into an existing parent module", () => {
    const files = [
      srcFile("src/lib/a.ts"),
      srcFile("src/lib/b.ts"),
      srcFile("src/lib/internal/c.ts"),
    ];

    const { modules } = analyzeWithAST(emptyExtraction, files);

    expect(modules).toHaveLength(1);
    expect(modules[0].files).toHaveLength(3);
  });

  it("keeps a lone small directory standalone", () => {
    const files = [
      srcFile("src/store/chat-store.ts"),
      srcFile("src/lib/a.ts"),
      srcFile("src/lib/b.ts"),
    ];

    const { modules } = analyzeWithAST(emptyExtraction, files);
    expect(modules.map((m) => m.id).sort()).toEqual(["lib", "store"]);
  });

  it("assigns every file to exactly one module", () => {
    const files = [
      srcFile("src/a.ts"),
      srcFile("src/b.ts"),
      srcFile("src/deep/nested/dir/c.ts"),
      srcFile("next.config.ts"),
      srcFile("scripts/build.ts"),
    ];

    const { modules } = analyzeWithAST(emptyExtraction, files);
    const assigned = modules.flatMap((m) => m.files);

    expect(assigned.sort()).toEqual(files.map((f) => f.relativePath).sort());
  });
});

describe("analyzeWithAST — categories", () => {
  it("infers categories from directory names", () => {
    const files = [
      srcFile("src/components/A.tsx"),
      srcFile("src/components/B.tsx"),
      srcFile("src/types/graph.ts"),
      srcFile("src/types/chat.ts"),
      srcFile("src/utils/format.ts"),
      srcFile("src/utils/parse.ts"),
      srcFile("src/app/api/chat/route.ts"),
      srcFile("src/app/api/repos/route.ts"),
    ];

    const { modules } = analyzeWithAST(emptyExtraction, files);
    const byId = Object.fromEntries(modules.map((m) => [m.id, m.category]));

    expect(byId["components"]).toBe("visual");
    expect(byId["types"]).toBe("data");
    expect(byId["utils"]).toBe("utility");
    expect(byId["app-api"]).toBe("proxy");
  });

  it("falls back to visual for tsx-heavy directories without keyword names", () => {
    const files = [srcFile("src/canvas/A.tsx"), srcFile("src/canvas/B.tsx")];
    const { modules } = analyzeWithAST(emptyExtraction, files);
    expect(modules[0].category).toBe("visual");
  });

  it("categorizes config-named root files as config", () => {
    const files = [
      srcFile("next.config.ts"),
      srcFile("eslint.config.ts"),
      srcFile("src/x/a.ts"),
      srcFile("src/x/b.ts"),
    ];
    const { modules } = analyzeWithAST(emptyExtraction, files);
    const root = modules.find((m) => m.id === "root")!;
    expect(root.category).toBe("config");
  });
});

describe("analyzeWithAST — symbols and responsibility", () => {
  it("collects keyTypes from classes and type-only exports", () => {
    const files = [srcFile("src/lib/cache.ts"), srcFile("src/lib/repo.ts")];
    const extraction: ExtractionResult = {
      files: [
        extracted({
          filePath: "src/lib/cache.ts",
          classes: [{ name: "GraphCache", methods: [{ name: "get", params: [] }], properties: [] }],
          exports: ["GraphCache", "CacheEntry"],
        }),
        extracted({
          filePath: "src/lib/repo.ts",
          functions: [{ name: "cloneRepo", params: ["url"] }],
          exports: ["cloneRepo", "RepoInfo"],
        }),
      ],
      dependencyEdges: [],
    };

    const { modules } = analyzeWithAST(extraction, files);
    const lib = modules[0];

    expect(lib.keyTypes).toContain("GraphCache");
    expect(lib.keyTypes).toContain("CacheEntry");
    expect(lib.keyTypes).toContain("RepoInfo");
    expect(lib.keyMethods).toContain("cloneRepo()");
    expect(lib.keyMethods).toContain("GraphCache.get()");
  });

  it("writes a deterministic responsibility sentence", () => {
    const files = [srcFile("src/lib/a.ts"), srcFile("src/lib/b.ts")];
    const extraction: ExtractionResult = {
      files: [
        extracted({
          filePath: "src/lib/a.ts",
          functions: [{ name: "parseUrl", params: [] }, { name: "cloneRepo", params: [] }],
        }),
      ],
      dependencyEdges: [],
    };

    const first = analyzeWithAST(extraction, files);
    const second = analyzeWithAST(extraction, files);

    expect(first.modules[0].responsibility).toBe(second.modules[0].responsibility);
    expect(first.modules[0].responsibility).toContain("parseUrl()");
  });
});

describe("analyzeWithAST — edges", () => {
  const files = [
    srcFile("src/lib/analyzer.ts"),
    srcFile("src/lib/cache.ts"),
    srcFile("src/types/graph.ts"),
    srcFile("src/types/chat.ts"),
  ];

  it("aggregates file-level dependencies into module edges", () => {
    const extraction: ExtractionResult = {
      files: [
        extracted({ filePath: "src/lib/analyzer.ts" }),
        extracted({ filePath: "src/lib/cache.ts" }),
        extracted({
          filePath: "src/types/graph.ts",
          functions: [{ name: "getColors", params: [] }],
          exports: ["getColors", "ArchGraph"],
        }),
        extracted({ filePath: "src/types/chat.ts" }),
      ],
      dependencyEdges: [
        { fromFile: "src/lib/analyzer.ts", toFile: "src/types/graph.ts", importedNames: ["getColors"] },
        { fromFile: "src/lib/cache.ts", toFile: "src/types/graph.ts", importedNames: ["ArchGraph"] },
        // Same-module import should not create an edge
        { fromFile: "src/lib/analyzer.ts", toFile: "src/lib/cache.ts", importedNames: ["getCached"] },
      ],
    };

    const { edges } = analyzeWithAST(extraction, files);

    expect(edges).toHaveLength(1);
    expect(edges[0].from).toBe("lib");
    expect(edges[0].to).toBe("types");
    expect(edges[0].type).toBe("depends");
  });

  it("marks type-only dependencies as weak", () => {
    const extraction: ExtractionResult = {
      files: [
        extracted({ filePath: "src/lib/analyzer.ts" }),
        extracted({ filePath: "src/lib/cache.ts" }),
        extracted({
          filePath: "src/types/graph.ts",
          functions: [{ name: "getColors", params: [] }],
          exports: ["getColors", "ArchGraph", "ArchModule"],
        }),
        extracted({ filePath: "src/types/chat.ts" }),
      ],
      dependencyEdges: [
        { fromFile: "src/lib/analyzer.ts", toFile: "src/types/graph.ts", importedNames: ["ArchGraph", "ArchModule"] },
      ],
    };

    const { edges } = analyzeWithAST(extraction, files);
    expect(edges[0].type).toBe("weak");
  });

  it("is fully deterministic across runs", () => {
    const extraction: ExtractionResult = {
      files: files.map((f) => extracted({ filePath: f.relativePath })),
      dependencyEdges: [
        { fromFile: "src/lib/analyzer.ts", toFile: "src/types/graph.ts", importedNames: ["A"] },
      ],
    };

    const a = analyzeWithAST(extraction, files);
    const b = analyzeWithAST(extraction, files);

    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
