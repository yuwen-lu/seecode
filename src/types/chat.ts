import type { NodeCategory, ArchModule } from "./graph";

export type SelectedModule = Omit<ArchModule, "lineCount">;

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  fileReferences?: FileReference[];
  timestamp: number;
}

export interface FileReference {
  filePath: string;
  moduleId: string;
  moduleName: string;
  category: NodeCategory;
}

export interface SelectedComponent {
  label: string;
  category: string;
  members: SelectedModule[];
}

export interface CanvasContext {
  repoUrl: string;
  commitSha: string;
  selected: SelectedModule | null;
  selectedComponent: SelectedComponent | null;
  neighbors: {
    id: string;
    name: string;
    category: string;
    responsibility: string;
    edgeType: string;
    direction: "to" | "from";
  }[];
  overview: {
    id: string;
    name: string;
    category: string;
    responsibility: string;
    files: string[];
  }[];
  zoomLevel: "system" | "module" | "detail";
  activeTrace: string | null;
  panelDepth: "component" | "module" | "file" | null;
  activeFile: string | null;
}
