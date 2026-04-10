import { describe, it, expect } from "vitest";
import { buildCanvasContext, serializeForPrompt } from "./canvas-context";
import type { ArchGraph, ArchModule, PanelSelection, NodeCategory } from "@/types/graph";

function makeModule(id: string, category: NodeCategory, name?: string): ArchModule {
  return {
    id,
    name: name ?? id,
    files: [`src/${id}.ts`],
    category,
    responsibility: `Handles ${id}`,
    keyTypes: [`${id}Type`],
    keyMethods: [`${id}Method()`],
    lineCount: 100,
  };
}

function makeGraph(
  modules: ArchModule[],
  edges: ArchGraph["edges"] = [],
): ArchGraph {
  return {
    repoUrl: "https://github.com/test/repo",
    repoName: "test/repo",
    commitSha: "abc123",
    analyzedAt: new Date().toISOString(),
    modules,
    edges,
    traces: [],
  };
}

describe("buildCanvasContext", () => {
  it("returns null selected when no selection", () => {
    const graph = makeGraph([makeModule("a", "core")]);
    const ctx = buildCanvasContext(graph, null, "system", null, null, null);
    expect(ctx.selected).toBeNull();
    expect(ctx.selectedComponent).toBeNull();
  });

  it("populates selected module correctly", () => {
    const mod = makeModule("auth", "core", "Auth Service");
    const graph = makeGraph([mod]);
    const selection: PanelSelection = { kind: "module", module: mod };
    const ctx = buildCanvasContext(graph, selection, "module", null, null, null);
    expect(ctx.selected).not.toBeNull();
    expect(ctx.selected!.id).toBe("auth");
    expect(ctx.selected!.name).toBe("Auth Service");
  });

  it("finds 1-hop neighbors for selected module", () => {
    const a = makeModule("a", "core");
    const b = makeModule("b", "data");
    const c = makeModule("c", "utility");
    const d = makeModule("d", "visual");
    const graph = makeGraph(
      [a, b, c, d],
      [
        { from: "a", to: "b", type: "depends" },
        { from: "c", to: "a", type: "dataflow" },
        { from: "c", to: "d", type: "depends" }, // unrelated to "a"
      ],
    );
    const ctx = buildCanvasContext(
      graph, { kind: "module", module: a }, "module", null, null, null,
    );
    expect(ctx.neighbors).toHaveLength(2);
    const toB = ctx.neighbors.find((n) => n.id === "b");
    expect(toB?.direction).toBe("to");
    expect(toB?.edgeType).toBe("depends");
    const fromC = ctx.neighbors.find((n) => n.id === "c");
    expect(fromC?.direction).toBe("from");
  });

  describe("duplicate neighbors — potential issue", () => {
    it("includes same module twice if there are both incoming and outgoing edges", () => {
      const a = makeModule("a", "core");
      const b = makeModule("b", "data");
      const graph = makeGraph(
        [a, b],
        [
          { from: "a", to: "b", type: "depends" },
          { from: "b", to: "a", type: "dataflow" },
        ],
      );
      const ctx = buildCanvasContext(
        graph, { kind: "module", module: a }, "module", null, null, null,
      );
      // Module "b" appears twice: once as "to" (depends), once as "from" (dataflow)
      const bNeighbors = ctx.neighbors.filter((n) => n.id === "b");
      expect(bNeighbors).toHaveLength(2);
      expect(bNeighbors.map((n) => n.direction).sort()).toEqual(["from", "to"]);
    });
  });

  describe("component selection", () => {
    it("selects component with multiple members", () => {
      const a = makeModule("a", "core");
      const b = makeModule("b", "core");
      const graph = makeGraph([a, b]);
      const selection: PanelSelection = {
        kind: "component",
        category: "core",
        label: "Core System",
        members: [a, b],
      };
      const ctx = buildCanvasContext(graph, selection, "system", null, null, null);
      expect(ctx.selectedComponent).not.toBeNull();
      expect(ctx.selectedComponent!.members).toHaveLength(2);
      expect(ctx.selected).toBeNull(); // more than 1 member → no single selected
    });

    it("single-member component also sets selected module", () => {
      const a = makeModule("a", "core");
      const graph = makeGraph([a]);
      const selection: PanelSelection = {
        kind: "component",
        category: "core",
        label: "Core System",
        members: [a],
      };
      const ctx = buildCanvasContext(graph, selection, "system", null, null, null);
      expect(ctx.selectedComponent).not.toBeNull();
      expect(ctx.selected).not.toBeNull();
      expect(ctx.selected!.id).toBe("a");
    });

    it("finds neighbors for all component members", () => {
      const a = makeModule("a", "core");
      const b = makeModule("b", "core");
      const c = makeModule("c", "data");
      const graph = makeGraph(
        [a, b, c],
        [
          { from: "a", to: "c", type: "depends" },
          { from: "b", to: "c", type: "dataflow" },
        ],
      );
      const selection: PanelSelection = {
        kind: "component",
        category: "core",
        label: "Core System",
        members: [a, b],
      };
      const ctx = buildCanvasContext(graph, selection, "system", null, null, null);
      // Both edges go to "c", but from different members → should both be captured
      // However, "c" might appear twice since it's found via two separate edges
      expect(ctx.neighbors.length).toBeGreaterThanOrEqual(1);
      expect(ctx.neighbors.every((n) => n.id === "c")).toBe(true);
    });
  });

  it("includes all modules in overview regardless of selection", () => {
    const modules = [
      makeModule("a", "core"),
      makeModule("b", "data"),
      makeModule("c", "utility"),
    ];
    const graph = makeGraph(modules);
    const ctx = buildCanvasContext(graph, null, "system", null, null, null);
    expect(ctx.overview).toHaveLength(3);
  });

  it("passes through metadata fields", () => {
    const graph = makeGraph([]);
    const ctx = buildCanvasContext(graph, null, "detail", "auth-flow", "file", "src/auth.ts");
    expect(ctx.zoomLevel).toBe("detail");
    expect(ctx.activeTrace).toBe("auth-flow");
    expect(ctx.panelDepth).toBe("file");
    expect(ctx.activeFile).toBe("src/auth.ts");
  });
});

describe("serializeForPrompt", () => {
  it("includes repo url and zoom level", () => {
    const graph = makeGraph([makeModule("a", "core")]);
    const ctx = buildCanvasContext(graph, null, "module", null, null, null);
    const text = serializeForPrompt(ctx);
    expect(text).toContain("github.com/test/repo");
    expect(text).toContain("Zoom level: module");
  });

  it("includes selected module details when present", () => {
    const mod = makeModule("auth", "core", "Auth Service");
    const graph = makeGraph([mod]);
    const ctx = buildCanvasContext(
      graph, { kind: "module", module: mod }, "detail", null, null, null,
    );
    const text = serializeForPrompt(ctx);
    expect(text).toContain("Auth Service");
    expect(text).toContain("auth");
    expect(text).toContain("authType");
    expect(text).toContain("authMethod()");
  });

  it("says 'No module selected' when nothing is selected", () => {
    const graph = makeGraph([makeModule("a", "core")]);
    const ctx = buildCanvasContext(graph, null, "system", null, null, null);
    const text = serializeForPrompt(ctx);
    expect(text).toContain("No module selected");
  });

  it("includes active trace when present", () => {
    const graph = makeGraph([]);
    const ctx = buildCanvasContext(graph, null, "system", "request-flow", null, null);
    const text = serializeForPrompt(ctx);
    expect(text).toContain("Active trace: request-flow");
  });

  it("truncates files list in overview when > 3 files", () => {
    const mod: ArchModule = {
      ...makeModule("big", "core"),
      files: ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"],
    };
    const graph = makeGraph([mod]);
    const ctx = buildCanvasContext(graph, null, "system", null, null, null);
    const text = serializeForPrompt(ctx);
    expect(text).toContain("(+2 more)");
  });

  it("serializes component selection with member list", () => {
    const a = makeModule("a", "core", "Auth");
    const b = makeModule("b", "core", "Users");
    const graph = makeGraph([a, b]);
    const selection: PanelSelection = {
      kind: "component",
      category: "core",
      label: "Core System",
      members: [a, b],
    };
    const ctx = buildCanvasContext(graph, selection, "system", null, null, null);
    const text = serializeForPrompt(ctx);
    expect(text).toContain("Selected Component: Core System");
    expect(text).toContain("**Auth**");
    expect(text).toContain("**Users**");
  });
});
