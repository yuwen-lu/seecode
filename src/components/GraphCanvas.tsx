"use client";

import { useCallback, useEffect, useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "dagre";
import type { ArchGraph, ArchModule } from "@/types/graph";
import { CATEGORY_COLORS } from "@/types/graph";
import { ArchNode } from "./ArchNode";

interface GraphCanvasProps {
  graph: ArchGraph;
  activeTrace: string | null;
  onNodeSelect: (module: ArchModule | null) => void;
  selectedNodeId: string | null;
}

const nodeTypes = { archNode: ArchNode };

const NODE_WIDTH = 220;
const NODE_HEIGHT = 80;

function layoutGraph(graph: ArchGraph): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 60, ranksep: 80, marginx: 40, marginy: 40 });

  for (const mod of graph.modules) {
    g.setNode(mod.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }

  for (const edge of graph.edges) {
    g.setEdge(edge.from, edge.to);
  }

  dagre.layout(g);

  const nodes: Node[] = graph.modules.map((mod) => {
    const pos = g.node(mod.id);
    return {
      id: mod.id,
      type: "archNode",
      position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 },
      data: { module: mod },
    };
  });

  const edges: Edge[] = graph.edges.map((edge, i) => ({
    id: `e-${i}`,
    source: edge.from,
    target: edge.to,
    label: edge.label,
    type: "default",
    animated: edge.type === "dataflow",
    style: {
      stroke:
        edge.type === "weak"
          ? "#3a3a55"
          : edge.type === "dataflow"
          ? "#7aa2f7"
          : "#5a6080",
      strokeWidth: edge.type === "dataflow" ? 2.5 : 1.5,
      strokeDasharray: edge.type === "weak" ? "6 3" : undefined,
    },
    labelStyle: { fill: "#888", fontSize: 10 },
  }));

  return { nodes, edges };
}

function GraphCanvasInner({
  graph,
  activeTrace,
  onNodeSelect,
  selectedNodeId,
}: GraphCanvasProps) {
  const { fitView } = useReactFlow();
  const { nodes: layoutNodes, edges: layoutEdges } = useMemo(
    () => layoutGraph(graph),
    [graph]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutEdges);

  // Update nodes/edges when graph changes
  useEffect(() => {
    setNodes(layoutNodes);
    setEdges(layoutEdges);
    // Fit view after layout
    setTimeout(() => fitView({ padding: 0.1, duration: 300 }), 100);
  }, [layoutNodes, layoutEdges, setNodes, setEdges, fitView]);

  // Highlight trace edges
  useEffect(() => {
    if (!activeTrace) {
      setEdges(layoutEdges);
      return;
    }

    const trace = graph.traces.find((t) => t.name === activeTrace);
    if (!trace) return;

    const traceEdgeSet = new Set<string>();
    for (let i = 0; i < trace.path.length - 1; i++) {
      traceEdgeSet.add(`${trace.path[i]}->${trace.path[i + 1]}`);
      traceEdgeSet.add(`${trace.path[i + 1]}->${trace.path[i]}`);
    }

    setEdges(
      layoutEdges.map((edge) => {
        const key = `${edge.source}->${edge.target}`;
        const isOnTrace = traceEdgeSet.has(key);
        return {
          ...edge,
          animated: isOnTrace,
          style: {
            ...edge.style,
            stroke: isOnTrace ? "#7aa2f7" : (edge.style?.stroke ?? "#5a6080"),
            strokeWidth: isOnTrace ? 3 : (Number(edge.style?.strokeWidth) || 1.5),
            opacity: isOnTrace ? 1 : 0.3,
          },
        };
      })
    );
  }, [activeTrace, graph.traces, layoutEdges, setEdges]);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      const mod = graph.modules.find((m) => m.id === node.id);
      onNodeSelect(mod ?? null);
    },
    [graph.modules, onNodeSelect]
  );

  const onPaneClick = useCallback(() => {
    onNodeSelect(null);
  }, [onNodeSelect]);

  return (
    <ReactFlow
      nodes={nodes.map((n) => ({
        ...n,
        selected: n.id === selectedNodeId,
      }))}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={onNodeClick}
      onPaneClick={onPaneClick}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.1 }}
      minZoom={0.1}
      maxZoom={3}
      panOnScroll
      selectionOnDrag
      panOnDrag={[1, 2]}
      selectionMode={1}
      zoomOnScroll={false}
      zoomOnPinch
      zoomOnDoubleClick={false}
      proOptions={{ hideAttribution: true }}
    >
      <Background color="#1a1a2a" gap={20} size={1} />
      <Controls position="bottom-left" />
      <MiniMap
        position="bottom-right"
        nodeColor={(node) => {
          const mod = node.data?.module as ArchModule | undefined;
          return mod ? CATEGORY_COLORS[mod.category]?.border ?? "#64748b" : "#64748b";
        }}
        maskColor="rgba(0, 0, 0, 0.7)"
        pannable
        zoomable
      />
    </ReactFlow>
  );
}

export function GraphCanvas(props: GraphCanvasProps) {
  return (
    <ReactFlowProvider>
      <GraphCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
