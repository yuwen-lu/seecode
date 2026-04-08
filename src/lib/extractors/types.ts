/** Shared output format for all language extractors */

export interface ExtractedFile {
  filePath: string;
  language: string;
  classes: ExtractedClass[];
  functions: ExtractedFunction[];
  imports: ExtractedImport[];
  exports: string[];
}

export interface ExtractedClass {
  name: string;
  methods: ExtractedFunction[];
  properties: string[];
  extends?: string;
  implements?: string[];
}

export interface ExtractedFunction {
  name: string;
  params: string[];
  returnType?: string;
  isAsync?: boolean;
}

export interface ExtractedImport {
  source: string; // module path or package name
  names: string[]; // imported identifiers (empty = default/namespace import)
  isDefault?: boolean;
}

export interface ExtractionResult {
  files: ExtractedFile[];
  dependencyEdges: DependencyEdge[];
}

export interface DependencyEdge {
  fromFile: string;
  toFile: string;
  importedNames: string[];
}
