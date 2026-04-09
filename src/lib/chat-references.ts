import type { ArchModule, NodeCategory } from "@/types/graph";

interface FileIndexEntry {
  moduleId: string;
  moduleName: string;
  category: NodeCategory;
}

export function buildFileIndex(modules: ArchModule[]): Map<string, FileIndexEntry> {
  const index = new Map<string, FileIndexEntry>();
  for (const mod of modules) {
    for (const file of mod.files) {
      index.set(file, { moduleId: mod.id, moduleName: mod.name, category: mod.category });
    }
  }
  return index;
}
