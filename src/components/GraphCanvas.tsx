"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  useReactFlow,
  useOnViewportChange,
  ReactFlowProvider,
  type Node,
  type Edge,
  type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { ArchGraph, ArchModule } from "@/types/graph";
import { ArchNode } from "./ArchNode";
import { GroupNode } from "./GroupNode";
import { DetailSlider } from "./DetailSlider";
import {
  getZoomLevel,
  buildCollapsedGraph,
  buildExpandedGraph,
  type ZoomLevel,
} from "@/lib/semantic-zoom";

interface GraphCanvasProps {
  graph: ArchGraph;
  activeTrace: string | null;
  onNodeSelect: (module: ArchModule | null) => void;
  selectedNodeId: string | null;
}

const nodeTypes = {
  archNode: ArchNode,
  groupNode: GroupNode,
};

function GraphCanvasInner({
  graph,
  activeTrace,
  onNodeSelect,
  selectedNodeId,
}: GraphCanvasProps) {
  const { fitView } = useReactFlow();
  const [zoomLevel, setZoomLevel] = useState<ZoomLevel>("compact");
  const [locked, setLocked] = useState(false);
  const prevZoomLevel = useRef<ZoomLevel>("compact");

  const collapsedLayout = useMemo(() => buildCollapsedGraph(graph), [graph]);
  const expandedLayout = useMemo(() => buildExpandedGraph(graph), [graph]);

  const currentLayout = zoomLevel === "collapsed" ? collapsedLayout : expandedLayout;

  const [nodes, setNodes, onNodesChange] = useNodesState(currentLayout.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(currentLayout.edges);

  // Watch viewport — only change zoom level if NOT locked
  useOnViewportChange({
    onChange: useCallback((viewport: Viewport) => {
      if (locked) return;
      const newLevel = getZoomLevel(viewport.zoom);
      if (newLevel !== prevZoomLevel.current) {
        prevZoomLevel.current = newLevel;
        setZoomLevel(newLevel);
      }
    }, [locked]),
  });

  // Swap nodes/edges when zoom level changes
  useEffect(() => {
    const layout = zoomLevel === "collapsed" ? collapsedLayout : expandedLayout;
    setNodes(layout.nodes);
    setEdges(layout.edges);
  }, [zoomLevel, collapsedLayout, expandedLayout, setNodes, setEdges]);

  // Initial fit on graph load only
  useEffect(() => {
    setTimeout(() => fitView({ padding: 0.12, duration: 300 }), 100);
  }, [graph, fitView]);

  // Trace highlighting (expanded view only)
  useEffect(() => {
    if (zoomLevel === "collapsed" || !activeTrace) {
      const layout = zoomLevel === "collapsed" ? collapsedLayout : expandedLayout;
      setEdges(layout.edges);
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
      expandedLayout.edges.map((edge) => {
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
  }, [activeTrace, zoomLevel, graph.traces, expandedLayout, collapsedLayout, setEdges]);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (node.type === "groupNode") {
        const members = (node.data as { members?: ArchModule[] })?.members;
        if (members && members.length > 0) {
          onNodeSelect(members[0]);
        }
        return;
      }
      const mod = graph.modules.find((m) => m.id === node.id);
      onNodeSelect(mod ?? null);
    },
    [graph.modules, onNodeSelect]
  );

  const onPaneClick = useCallback(() => {
    onNodeSelect(null);
  }, [onNodeSelect]);

  // Manual level change from slider
  function handleLevelChange(level: ZoomLevel) {
    prevZoomLevel.current = level;
    setZoomLevel(level);
  }

  return (
    <>
      <ReactFlow
        nodes={nodes.map((n) => {
          const isSelected = n.id === selectedNodeId ||
            (n.type === "groupNode" && selectedNodeId
              ? ((n.data as { members?: ArchModule[] })?.members ?? []).some((m) => m.id === selectedNodeId)
              : false);
          return {
            ...n,
            selected: isSelected,
            data: { ...n.data, dimmed: !!selectedNodeId && !isSelected },
          };
        })}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.12 }}
        minZoom={0.1}
        maxZoom={3}
        panOnScroll
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#1a1a2a" gap={20} size={1} />
        <Controls position="bottom-left" showInteractive={false} />
      </ReactFlow>

      {/* Detail level slider — bottom right */}
      <DetailSlider
        level={zoomLevel}
        locked={locked}
        onLevelChange={handleLevelChange}
        onLockedChange={setLocked}
      />
    </>
  );
}

export function GraphCanvas(props: GraphCanvasProps) {
  if (!props.graph.modules || props.graph.modules.length === 0) {
    return (
      <div className="h-full w-full flex items-center justify-center">
        <div className="text-center max-w-sm">
          <p className="text-text-secondary text-sm">
            No modules to display. The graph is empty.
          </p>
        </div>
      </div>
    );
  }

  return (
    <ReactFlowProvider>
      <GraphCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
