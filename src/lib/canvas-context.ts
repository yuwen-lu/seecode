import type { ArchGraph, ArchModule, PanelSelection } from "@/types/graph";
import type { CanvasContext, SelectedModule, SelectedComponent } from "@/types/chat";
import type { PanelDepth } from "@/components/DetailPanel";

function moduleToSelected(mod: ArchModule): SelectedModule {
  return {
    id: mod.id, name: mod.name, category: mod.category,
    responsibility: mod.responsibility, files: mod.files,
    keyTypes: mod.keyTypes, keyMethods: mod.keyMethods,
  };
}

export function buildCanvasContext(
  graph: ArchGraph,
  selection: PanelSelection | null,
  zoomLevel: "system" | "module" | "detail",
  activeTrace: string | null,
  panelDepth: PanelDepth | null,
  activeFile: string | null,
): CanvasContext {
  let selectedModule: ArchModule | null = null;
  let selectedComponent: SelectedComponent | null = null;

  if (selection?.kind === "module") {
    selectedModule = selection.module;
  } else if (selection?.kind === "component") {
    selectedComponent = {
      label: selection.label,
      category: selection.category,
      members: selection.members.map(moduleToSelected),
    };
    // If only one member, also set it as the selected module for convenience
    if (selection.members.length === 1) {
      selectedModule = selection.members[0];
    }
  }

  // Find 1-hop neighbors for the selected module (or all members of the component)
  const neighborSourceIds = selectedModule
    ? [selectedModule.id]
    : selectedComponent
      ? selectedComponent.members.map((m) => m.id)
      : [];

  const neighborSet = new Set(neighborSourceIds);
  const neighbors: CanvasContext["neighbors"] = [];

  for (const edge of graph.edges) {
    if (neighborSet.has(edge.from) && !neighborSet.has(edge.to)) {
      const target = graph.modules.find((m) => m.id === edge.to);
      if (target) {
        neighbors.push({
          id: target.id, name: target.name, category: target.category,
          responsibility: target.responsibility, edgeType: edge.type, direction: "to",
        });
      }
    } else if (neighborSet.has(edge.to) && !neighborSet.has(edge.from)) {
      const source = graph.modules.find((m) => m.id === edge.from);
      if (source) {
        neighbors.push({
          id: source.id, name: source.name, category: source.category,
          responsibility: source.responsibility, edgeType: edge.type, direction: "from",
        });
      }
    }
  }

  return {
    repoUrl: graph.repoUrl,
    commitSha: graph.commitSha,
    selected: selectedModule ? moduleToSelected(selectedModule) : null,
    selectedComponent,
    neighbors,
    overview: graph.modules.map((m) => ({
      id: m.id, name: m.name, category: m.category, responsibility: m.responsibility, files: m.files,
    })),
    zoomLevel, activeTrace, panelDepth: panelDepth ?? null, activeFile,
  };
}

export function serializeForPrompt(ctx: CanvasContext): string {
  const lines: string[] = [];
  lines.push("## Current View");
  lines.push(`- Repository: ${ctx.repoUrl}`);
  lines.push(`- Zoom level: ${ctx.zoomLevel}`);
  if (ctx.activeTrace) lines.push(`- Active trace: ${ctx.activeTrace}`);

  if (ctx.selected) {
    lines.push("", `## Selected Module: ${ctx.selected.name} (id: ${ctx.selected.id})`);
    lines.push(`- Category: ${ctx.selected.category}`);
    lines.push(`- Responsibility: ${ctx.selected.responsibility}`);
    if (ctx.selected.files.length > 0) lines.push(`- Files: ${ctx.selected.files.join(", ")}`);
    if (ctx.selected.keyTypes.length > 0) lines.push(`- Key Types: ${ctx.selected.keyTypes.join(", ")}`);
    if (ctx.selected.keyMethods.length > 0) lines.push(`- Key Methods: ${ctx.selected.keyMethods.join(", ")}`);
    if (ctx.panelDepth) lines.push(`- Panel depth: ${ctx.panelDepth}`);
    if (ctx.activeFile) lines.push(`- Viewing file: ${ctx.activeFile}`);
  } else if (ctx.selectedComponent) {
    lines.push("", `## Selected Component: ${ctx.selectedComponent.label} [${ctx.selectedComponent.category}]`);
    lines.push(`Contains ${ctx.selectedComponent.members.length} modules:`);
    for (const m of ctx.selectedComponent.members) {
      lines.push(`- **${m.name}** (id: ${m.id}): ${m.responsibility}`);
      if (m.files.length > 0) lines.push(`  Files: ${m.files.join(", ")}`);
      if (m.keyMethods.length > 0) lines.push(`  Key Methods: ${m.keyMethods.join(", ")}`);
    }
  } else {
    lines.push("- No module selected (answer based on overall architecture)");
  }

  if (ctx.neighbors.length > 0) {
    lines.push("", "## Connected Modules (1-hop)");
    for (const n of ctx.neighbors) {
      const arrow = n.direction === "to" ? `-> ${n.edgeType} ->` : `<- ${n.edgeType} <-`;
      lines.push(`- ${arrow} ${n.name} [${n.category}]: ${n.responsibility}`);
    }
  }

  lines.push("", "## All Modules");
  for (const m of ctx.overview) {
    const fileList = m.files.length <= 3 ? m.files.join(", ") : `${m.files.slice(0, 3).join(", ")} (+${m.files.length - 3} more)`;
    lines.push(`- ${m.name} [${m.category}]: ${m.responsibility} | Files: ${fileList}`);
  }

  return lines.join("\n");
}
