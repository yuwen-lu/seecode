import { describe, it, expect } from "vitest";
import { getZoomLevel, buildHybridGraph } from "./semantic-zoom";
import type { ArchGraph, ArchModule, NodeCategory } from "@/types/graph";

function makeModule(id: string, category: NodeCategory, name?: string): ArchModule {
  return {
    id,
    name: name ?? id,
    files: [`${id}.ts`],
    category,
    responsibility: `Handles ${id}`,
    keyTypes: [],
    keyMethods: [],
    lineCount: 100,
  };
}

function makeGraph(modules: ArchModule[], edges: ArchGraph["edges"] = []): ArchGraph {
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

describe("getZoomLevel", () => {
  it("returns collapsed for very low zoom", () => {
    expect(getZoomLevel(0.1)).toBe("collapsed");
    expect(getZoomLevel(0.3)).toBe("collapsed");
  });

  it("returns compact for mid zoom", () => {
    expect(getZoomLevel(0.5)).toBe("compact");
    expect(getZoomLevel(0.7)).toBe("compact");
  });

  it("returns detailed for high zoom", () => {
    expect(getZoomLevel(1.0)).toBe("detailed");
    expect(getZoomLevel(2.0)).toBe("detailed");
  });

  describe("boundary values", () => {
    it("zoom exactly at 0.45 returns compact (not collapsed)", () => {
      expect(getZoomLevel(0.45)).toBe("compact");
    });

    it("zoom just below 0.45 returns collapsed", () => {
      expect(getZoomLevel(0.4499)).toBe("collapsed");
    });

    it("zoom exactly at 0.75 returns detailed (not compact)", () => {
      expect(getZoomLevel(0.75)).toBe("detailed");
    });

    it("zoom just below 0.75 returns compact", () => {
      expect(getZoomLevel(0.7499)).toBe("compact");
    });
  });

  describe("edge cases", () => {
    it("handles zoom of 0", () => {
      expect(getZoomLevel(0)).toBe("collapsed");
    });

    it("handles negative zoom", () => {
      expect(getZoomLevel(-1)).toBe("collapsed");
    });

    it("handles very large zoom", () => {
      expect(getZoomLevel(100)).toBe("detailed");
    });
  });
});

describe("buildHybridGraph", () => {
  it("fully expanded: every module is its own node", () => {
    const graph = makeGraph([
      makeModule("auth", "core"),
      makeModule("db", "data"),
    ]);
    const allCategories = new Set<NodeCategory>(["core", "data"]);
    const result = buildHybridGraph(graph, allCategories);
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes.every((n) => n.type === "archNode")).toBe(true);
  });

  it("fully collapsed: categories become group nodes", () => {
    const graph = makeGraph([
      makeModule("auth", "core"),
      makeModule("users", "core"),
      makeModule("db", "data"),
    ]);
    const result = buildHybridGraph(graph, new Set());
    expect(result.nodes).toHaveLength(2); // group-core, group-data
    expect(result.nodes.every((n) => n.type === "groupNode")).toBe(true);
  });

  it("mixed: some expanded, some collapsed", () => {
    const graph = makeGraph([
      makeModule("auth", "core"),
      makeModule("users", "core"),
      makeModule("db", "data"),
    ]);
    const result = buildHybridGraph(graph, new Set<NodeCategory>(["core"]));
    const archNodes = result.nodes.filter((n) => n.type === "archNode");
    const groupNodes = result.nodes.filter((n) => n.type === "groupNode");
    expect(archNodes).toHaveLength(2); // auth, users
    expect(groupNodes).toHaveLength(1); // group-data
  });

  describe("edge deduplication and self-loops", () => {
    it("deduplicates edges that collapse to the same group", () => {
      const graph = makeGraph(
        [makeModule("a1", "core"), makeModule("a2", "core"), makeModule("b1", "data")],
        [
          { from: "a1", to: "b1", type: "depends" },
          { from: "a2", to: "b1", type: "depends" },
        ],
      );
      // Both a1 and a2 collapse to group-core, so both edges become group-core -> b1
      const result = buildHybridGraph(graph, new Set<NodeCategory>(["data"]));
      const edgesFromGroup = result.edges.filter((e) => e.source === "group-core");
      expect(edgesFromGroup).toHaveLength(1); // deduplicated
    });

    it("removes self-loops when both endpoints collapse to same group", () => {
      const graph = makeGraph(
        [makeModule("a1", "core"), makeModule("a2", "core")],
        [{ from: "a1", to: "a2", type: "depends" }],
      );
      const result = buildHybridGraph(graph, new Set());
      // Both collapse to group-core, so edge becomes group-core -> group-core = self-loop
      expect(result.edges).toHaveLength(0);
    });
  });

  it("handles empty graph", () => {
    const graph = makeGraph([]);
    const result = buildHybridGraph(graph, new Set());
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
  });

  it("handles edges referencing unknown module IDs", () => {
    const graph = makeGraph(
      [makeModule("a", "core")],
      [{ from: "a", to: "ghost", type: "depends" }],
    );
    // "ghost" isn't in nodeIdMap, so it falls through to raw edge.to = "ghost"
    // dagre will still layout, but the edge points to a non-existent node
    const result = buildHybridGraph(graph, new Set<NodeCategory>(["core"]));
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].target).toBe("ghost");
  });

  it("group node data includes member count and total lines", () => {
    const graph = makeGraph([
      { ...makeModule("a", "utility"), lineCount: 50 },
      { ...makeModule("b", "utility"), lineCount: 150 },
    ]);
    const result = buildHybridGraph(graph, new Set());
    const groupData = result.nodes[0].data as { memberCount: number; totalLines: number };
    expect(groupData.memberCount).toBe(2);
    expect(groupData.totalLines).toBe(200);
  });

  it("correctly assigns positions from dagre layout", () => {
    const graph = makeGraph([
      makeModule("a", "core"),
      makeModule("b", "data"),
    ]);
    const result = buildHybridGraph(graph, new Set<NodeCategory>(["core", "data"]));
    for (const node of result.nodes) {
      expect(typeof node.position.x).toBe("number");
      expect(typeof node.position.y).toBe("number");
      expect(Number.isFinite(node.position.x)).toBe(true);
      expect(Number.isFinite(node.position.y)).toBe(true);
    }
  });
});
