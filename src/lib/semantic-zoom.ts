import type { Node, Edge } from "@xyflow/react";
import dagre from "dagre";
import type { ArchGraph, ArchModule, ArchEdge, NodeCategory } from "@/types/graph";
import { CATEGORY_LABELS } from "@/types/graph";
import type { GroupNodeData } from "@/components/GroupNode";

export type ZoomLevel = "collapsed" | "compact" | "detailed";

export function getZoomLevel(zoom: number): ZoomLevel {
  if (zoom < 0.45) return "collapsed";
  if (zoom < 0.75) return "compact";
  return "detailed";
}

const GROUP_NODE_WIDTH = 400;
const GROUP_NODE_HEIGHT = 180;
const NODE_WIDTH = 220;
const NODE_HEIGHT = 140;

function buildGroupDescription(members: ArchModule[]): string {
  if (members.length === 1) return members[0].responsibility;
  return members
    .slice(0, 2)
    .map((m) => m.name)
    .join(", ") + (members.length > 2 ? ` and ${members.length - 2} more` : "");
}

const GROUP_LABELS: Partial<Record<NodeCategory, string>> = {
  core: "Core System",
  voice: "Voice Input Pipeline",
  visual: "Visual / UI Layer",
  "api-client": "AI / API Clients",
  proxy: "API Proxy",
  external: "External Services",
  utility: "Utilities",
  data: "Data Layer",
  config: "Configuration",
};

function makeEdgeStyle(edge: ArchEdge) {
  return {
    stroke:
      edge.type === "weak"
        ? "var(--edge-weak)"
        : edge.type === "dataflow"
        ? "var(--edge-dataflow)"
        : "var(--edge-default)",
    strokeWidth: edge.type === "dataflow" ? 2 : 1.2,
    strokeDasharray: edge.type === "weak" ? "6 3" : undefined,
  };
}

/**
 * Build a hybrid graph where some categories are collapsed into group nodes
 * and others are expanded into individual nodes.
 *
 * @param expandedCategories - categories to show as individual nodes
 *   If empty → fully collapsed. If all categories → fully expanded.
 */
export function buildHybridGraph(
  graph: ArchGraph,
  expandedCategories: Set<NodeCategory>,
): { nodes: Node[]; edges: Edge[]; nodeIdMap: Map<string, string> } {
  // Group modules by category
  const groups = new Map<NodeCategory, ArchModule[]>();
  for (const mod of graph.modules) {
    const list = groups.get(mod.category) ?? [];
    list.push(mod);
    groups.set(mod.category, list);
  }

  // Build node ID mapping: module ID → actual node ID in the graph
  // For collapsed categories, all modules map to the group node ID
  const nodeIdMap = new Map<string, string>();
  for (const mod of graph.modules) {
    if (expandedCategories.has(mod.category)) {
      nodeIdMap.set(mod.id, mod.id);
    } else {
      nodeIdMap.set(mod.id, `group-${mod.category}`);
    }
  }

  // Build nodes
  const nodes: Node[] = [];

  for (const [category, members] of groups) {
    if (expandedCategories.has(category)) {
      // Expanded: individual nodes
      for (const mod of members) {
        nodes.push({
          id: mod.id,
          type: "archNode",
          position: { x: 0, y: 0 },
          data: { module: mod },
        });
      }
    } else {
      // Collapsed: group node
      const groupId = `group-${category}`;
      const totalLines = members.reduce((sum, m) => sum + (m.lineCount ?? 0), 0);
      const data: GroupNodeData = {
        category,
        label: GROUP_LABELS[category] ?? CATEGORY_LABELS[category],
        description: buildGroupDescription(members),
        memberCount: members.length,
        members,
        totalLines,
      };
      nodes.push({
        id: groupId,
        type: "groupNode",
        position: { x: 0, y: 0 },
        data,
      });
    }
  }

  // Build edges with deduplication
  const seenEdges = new Set<string>();
  const edges: Edge[] = [];

  for (const edge of graph.edges) {
    const fromId = nodeIdMap.get(edge.from) ?? edge.from;
    const toId = nodeIdMap.get(edge.to) ?? edge.to;

    // Skip self-loops
    if (fromId === toId) continue;

    const key = `${fromId}->${toId}`;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);

    edges.push({
      id: `e-${edges.length}`,
      source: fromId,
      target: toId,
      label: edge.label,
      type: "default",
      animated: edge.type === "dataflow",
      style: makeEdgeStyle(edge),
      labelStyle: { fill: "var(--edge-label)", fontSize: 9, fontWeight: 400 },
      labelBgStyle: { fill: "var(--edge-label-bg)", fillOpacity: 0.85 },
      labelBgPadding: [4, 2] as [number, number],
      labelBgBorderRadius: 3,
    });
  }

  // Layout with dagre
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 70, ranksep: 90, marginx: 40, marginy: 40 });

  for (const node of nodes) {
    const isGroup = node.type === "groupNode";
    g.setNode(node.id, {
      width: isGroup ? GROUP_NODE_WIDTH : NODE_WIDTH,
      height: isGroup ? GROUP_NODE_HEIGHT : NODE_HEIGHT,
    });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }
  dagre.layout(g);

  for (const node of nodes) {
    const pos = g.node(node.id);
    const isGroup = node.type === "groupNode";
    const w = isGroup ? GROUP_NODE_WIDTH : NODE_WIDTH;
    const h = isGroup ? GROUP_NODE_HEIGHT : NODE_HEIGHT;
    node.position = { x: pos.x - w / 2, y: pos.y - h / 2 };
  }

  return { nodes, edges, nodeIdMap };
}

