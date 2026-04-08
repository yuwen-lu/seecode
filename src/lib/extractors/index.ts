import path from "path";
import type { SourceFile } from "@/lib/repo";
import type { ExtractedFile, ExtractionResult, DependencyEdge } from "./types";
import { extractTypeScript } from "./typescript";
import { extractPython } from "./python";
import { extractGo } from "./go";
import { extractRust } from "./rust";

const TREE_SITTER_LANGUAGES = new Set([
  "typescript", "javascript", "python", "go", "rust",
]);

/**
 * Extract structure from all source files using Tree-sitter.
 * Files in unsupported languages are skipped (they'll go to LLM-only analysis).
 */
export function extractAll(sourceFiles: SourceFile[]): ExtractionResult {
  const files: ExtractedFile[] = [];

  for (const sf of sourceFiles) {
    if (!TREE_SITTER_LANGUAGES.has(sf.language)) continue;

    try {
      const extracted = extractFile(sf);
      if (extracted) files.push(extracted);
    } catch (err) {
      // Skip files that fail to parse
      console.warn(`Failed to parse ${sf.relativePath}:`, err);
    }
  }

  const dependencyEdges = buildDependencyEdges(files);

  return { files, dependencyEdges };
}

function extractFile(sf: SourceFile): ExtractedFile | null {
  switch (sf.language) {
    case "typescript":
    case "javascript":
      return extractTypeScript(sf.absolutePath, sf.relativePath);
    case "python":
      return extractPython(sf.absolutePath, sf.relativePath);
    case "go":
      return extractGo(sf.absolutePath, sf.relativePath);
    case "rust":
      return extractRust(sf.absolutePath, sf.relativePath);
    default:
      return null;
  }
}

/**
 * Build dependency edges by resolving import paths to file paths.
 */
function buildDependencyEdges(files: ExtractedFile[]): DependencyEdge[] {
  const edges: DependencyEdge[] = [];

  // Build a lookup: relative path (without extension) -> file path
  const pathLookup = new Map<string, string>();
  for (const f of files) {
    const noExt = f.filePath.replace(/\.[^.]+$/, "");
    pathLookup.set(noExt, f.filePath);
    pathLookup.set(f.filePath, f.filePath);
    // Also add the filename without dir for simple matches
    const basename = path.basename(noExt);
    if (!pathLookup.has(basename)) {
      pathLookup.set(basename, f.filePath);
    }
  }

  for (const file of files) {
    for (const imp of file.imports) {
      // Try to resolve the import source to a file in the project
      const resolved = resolveImport(imp.source, file.filePath, pathLookup);
      if (resolved && resolved !== file.filePath) {
        edges.push({
          fromFile: file.filePath,
          toFile: resolved,
          importedNames: imp.names,
        });
      }
    }
  }

  return edges;
}

function resolveImport(
  source: string,
  fromFile: string,
  lookup: Map<string, string>,
): string | null {
  // Skip external packages (node_modules, pip packages, crates, etc.)
  if (!source.startsWith(".") && !source.startsWith("/")) {
    // Could be a project-relative import (like Go packages or Python modules)
    // Try to match against known files
    const cleaned = source.replace(/\//g, path.sep);
    if (lookup.has(cleaned)) return lookup.get(cleaned)!;

    // Try last segment (e.g., "github.com/foo/bar" -> "bar")
    const last = source.split(/[/:]/).pop();
    if (last && lookup.has(last)) return lookup.get(last)!;

    return null; // External package
  }

  // Relative import: resolve relative to the importing file
  const fromDir = path.dirname(fromFile);
  const resolved = path.normalize(path.join(fromDir, source));

  // Try with and without extensions
  if (lookup.has(resolved)) return lookup.get(resolved)!;

  const noExt = resolved.replace(/\.[^.]+$/, "");
  if (lookup.has(noExt)) return lookup.get(noExt)!;

  // Try /index variants
  const indexPath = path.join(resolved, "index");
  if (lookup.has(indexPath)) return lookup.get(indexPath)!;

  return null;
}

export type { ExtractedFile, ExtractionResult, DependencyEdge } from "./types";
