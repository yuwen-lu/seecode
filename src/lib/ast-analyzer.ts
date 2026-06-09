import fs from "fs";
import path from "path";
import type { ExtractionResult, ExtractedFile } from "./extractors";
import type { SourceFile } from "./repo";
import type { ArchModule, ArchEdge, NodeCategory } from "@/types/graph";

export interface ASTAnalysisResult {
  modules: ArchModule[];
  edges: ArchEdge[];
}

/** Languages the deterministic analyzer fully supports. */
const SUPPORTED_LANGUAGES = new Set(["typescript", "javascript"]);

/**
 * Whether a repo can be analyzed deterministically (without an LLM).
 * Currently limited to TypeScript/JavaScript codebases.
 */
export function canAnalyzeWithAST(primaryLanguage: string): boolean {
  return SUPPORTED_LANGUAGES.has(primaryLanguage);
}

/**
 * Build the architecture graph deterministically from Tree-sitter extraction:
 * - modules: files grouped by directory (small sibling dirs merged together)
 * - categories: inferred from path keywords and file types
 * - keyTypes/keyMethods/responsibility: derived from extracted symbols
 * - edges: file-level import edges aggregated to module level
 */
export function analyzeWithAST(
  extraction: ExtractionResult,
  sourceFiles: SourceFile[],
): ASTAnalysisResult {
  const groups = groupFilesByDirectory(sourceFiles);
  const extractedByPath = new Map<string, ExtractedFile>(
    extraction.files.map((f) => [f.filePath, f]),
  );
  const lineCounts = countLines(sourceFiles);

  const dirs = [...groups.keys()].sort();
  const idByDir = assignModuleIds(dirs);

  const modules: ArchModule[] = dirs.map((dir) => {
    const files = groups.get(dir)!.sort();
    const extracted = files
      .map((f) => extractedByPath.get(f))
      .filter((f): f is ExtractedFile => f !== undefined);
    const category = inferCategory(dir, files);

    return {
      id: idByDir.get(dir)!,
      name: moduleName(dir, idByDir),
      files,
      category,
      responsibility: buildResponsibility(files, extracted),
      keyTypes: collectKeyTypes(extracted),
      keyMethods: collectKeyMethods(extracted),
      lineCount: files.reduce((sum, f) => sum + (lineCounts.get(f) ?? 0), 0),
    };
  });

  const edges = buildModuleEdges(extraction, groups, idByDir, extractedByPath);

  return { modules, edges };
}

function countLines(sourceFiles: SourceFile[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const sf of sourceFiles) {
    try {
      const content = fs.readFileSync(sf.absolutePath, "utf-8");
      counts.set(toPosix(sf.relativePath), content.split("\n").length);
    } catch {
      // Unreadable file — leave the count out
    }
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

const MIN_FILES_PER_MODULE = 2;

/**
 * Group files by their containing directory. Directories with a single file
 * are merged into their parent when the parent already has files, or when
 * sibling directories are also small (so e.g. `app/api/analyze`, `app/api/chat`
 * collapse into one `app/api` module). Lone small directories stay standalone.
 */
function groupFilesByDirectory(sourceFiles: SourceFile[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();

  for (const sf of sourceFiles) {
    const rel = toPosix(sf.relativePath);
    const dir = path.posix.dirname(rel);
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir)!.push(rel);
  }

  let changed = true;
  while (changed) {
    changed = false;
    const smallDirs = [...groups.keys()]
      .filter((d) => d !== "." && groups.get(d)!.length < MIN_FILES_PER_MODULE)
      .sort();

    for (const dir of smallDirs) {
      if (!groups.has(dir)) continue; // already merged this round
      const parent = path.posix.dirname(dir);

      const hasSmallSibling = smallDirs.some(
        (d) => d !== dir && groups.has(d) && path.posix.dirname(d) === parent,
      );

      if (groups.has(parent) || hasSmallSibling) {
        const files = groups.get(dir)!;
        groups.delete(dir);
        if (!groups.has(parent)) groups.set(parent, []);
        groups.get(parent)!.push(...files);
        changed = true;
      }
    }
  }

  return groups;
}

/** Assign stable kebab-case ids; "." becomes "root", "src/" prefix is dropped. */
function assignModuleIds(dirs: string[]): Map<string, string> {
  const ids = new Map<string, string>();
  const used = new Set<string>();

  for (const dir of dirs) {
    const base = dir === "." ? "root" : stripSrc(dir).replace(/\//g, "-") || "root";
    let id = base;
    let n = 2;
    while (used.has(id)) id = `${base}-${n++}`;
    used.add(id);
    ids.set(dir, id);
  }
  return ids;
}

function moduleName(dir: string, idByDir: Map<string, string>): string {
  if (dir === ".") return "Root";

  const segments = stripSrc(dir).split("/").filter(Boolean);
  const last = segments[segments.length - 1] ?? "Root";

  // Disambiguate if another module ends in the same segment
  const collision = [...idByDir.keys()].some(
    (d) => d !== dir && d !== "." && stripSrc(d).split("/").pop() === last,
  );
  const label = collision ? segments.slice(-2).join("/") : last;
  return titleCase(label);
}

function stripSrc(dir: string): string {
  return dir.replace(/^src\//, "").replace(/^src$/, "");
}

function titleCase(s: string): string {
  return s
    .split(/[-_/]/)
    .filter(Boolean)
    .map((w) => (w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

const CATEGORY_KEYWORDS: [NodeCategory, string[]][] = [
  ["voice", ["voice", "audio", "speech", "sound", "tts", "stt"]],
  ["visual", ["components", "component", "ui", "views", "view", "pages", "screens", "widgets"]],
  ["proxy", ["api", "server", "middleware", "routes", "controllers", "endpoints"]],
  ["api-client", ["client", "clients", "sdk", "services", "agents", "agent", "llm", "ai"]],
  ["data", ["types", "models", "model", "schemas", "schema", "entities", "store", "stores", "state", "data", "db", "database"]],
  ["config", ["config", "configs", "settings", "constants", "env"]],
  ["utility", ["utils", "util", "helpers", "helper", "lib", "libs", "shared", "common", "hooks", "tools", "scripts"]],
  ["core", ["core", "engine", "domain", "main", "app"]],
];

function inferCategory(dir: string, files: string[]): NodeCategory {
  // Path keywords, checked from the most specific (last) segment outward
  const segments = dir === "." ? [] : dir.toLowerCase().split("/");
  for (let i = segments.length - 1; i >= 0; i--) {
    for (const [category, keywords] of CATEGORY_KEYWORDS) {
      if (category === "core") continue; // core is handled after content checks
      if (keywords.includes(segments[i])) return category;
    }
  }

  // Mostly React components → visual
  const tsxCount = files.filter((f) => f.endsWith(".tsx") || f.endsWith(".jsx")).length;
  if (files.length > 0 && tsxCount / files.length >= 0.5) return "visual";

  // Mostly config-named files (e.g. repo-root next.config.ts) → config
  const configCount = files.filter((f) => /config|\brc\b/.test(path.posix.basename(f).toLowerCase())).length;
  if (files.length > 0 && configCount / files.length >= 0.5) return "config";

  for (let i = segments.length - 1; i >= 0; i--) {
    if (CATEGORY_KEYWORDS.find(([c]) => c === "core")![1].includes(segments[i])) return "core";
  }

  return "core";
}

// ---------------------------------------------------------------------------
// Symbols & descriptions
// ---------------------------------------------------------------------------

const MAX_KEY_ITEMS = 8;

function collectKeyTypes(extracted: ExtractedFile[]): string[] {
  const types: string[] = [];
  for (const f of extracted) {
    for (const cls of f.classes) types.push(cls.name);
    const valueNames = new Set([
      ...f.classes.map((c) => c.name),
      ...f.functions.map((fn) => fn.name),
    ]);
    // Exported names that aren't classes/functions are interfaces/type aliases
    for (const exp of f.exports) {
      if (!valueNames.has(exp) && isPascalCase(exp)) types.push(exp);
    }
  }
  return dedupe(types).slice(0, MAX_KEY_ITEMS);
}

function collectKeyMethods(extracted: ExtractedFile[]): string[] {
  const exported: string[] = [];
  const rest: string[] = [];

  for (const f of extracted) {
    const exportSet = new Set(f.exports);
    for (const fn of f.functions) {
      (exportSet.has(fn.name) ? exported : rest).push(`${fn.name}()`);
    }
    for (const cls of f.classes) {
      for (const m of cls.methods) rest.push(`${cls.name}.${m.name}()`);
    }
  }
  return dedupe([...exported, ...rest]).slice(0, MAX_KEY_ITEMS);
}

function buildResponsibility(files: string[], extracted: ExtractedFile[]): string {
  const classes = dedupe(extracted.flatMap((f) => f.classes.map((c) => c.name)));
  const components = dedupe(
    extracted
      .filter((f) => f.language === "tsx")
      .flatMap((f) => f.functions.map((fn) => fn.name))
      .filter((n) => /^[A-Z]/.test(n)),
  );
  const functions = dedupe(
    extracted
      .filter((f) => f.language !== "tsx")
      .flatMap((f) => f.functions.map((fn) => fn.name)),
  );

  if (components.length > 0) {
    return `${files.length} file${plural(files.length)} with React components such as ${listSome(components)}.`;
  }
  if (classes.length > 0) {
    return `Defines ${listSome(classes)} across ${files.length} file${plural(files.length)}.`;
  }
  if (functions.length > 0) {
    return `Provides ${listSome(functions.map((f) => f + "()"))} across ${files.length} file${plural(files.length)}.`;
  }
  return `${files.length} source file${plural(files.length)}.`;
}

function listSome(names: string[], max = 3): string {
  const shown = names.slice(0, max).join(", ");
  const more = names.length - max;
  return more > 0 ? `${shown} and ${more} more` : shown;
}

function plural(n: number): string {
  return n === 1 ? "" : "s";
}

function dedupe(items: string[]): string[] {
  return [...new Set(items)];
}

/** PascalCase names are likely interfaces/type aliases; SCREAMING_CASE and camelCase are values. */
function isPascalCase(name: string): boolean {
  return /^[A-Z]/.test(name) && !/^[A-Z0-9_]+$/.test(name);
}

// ---------------------------------------------------------------------------
// Edges
// ---------------------------------------------------------------------------

function buildModuleEdges(
  extraction: ExtractionResult,
  groups: Map<string, string[]>,
  idByDir: Map<string, string>,
  extractedByPath: Map<string, ExtractedFile>,
): ArchEdge[] {
  const moduleByFile = new Map<string, string>();
  const dirByModule = new Map<string, string>();
  for (const [dir, files] of groups) {
    const id = idByDir.get(dir)!;
    dirByModule.set(id, dir);
    for (const f of files) moduleByFile.set(f, id);
  }

  const aggregated = new Map<string, { from: string; to: string; names: string[] }>();

  for (const edge of extraction.dependencyEdges) {
    const from = moduleByFile.get(toPosix(edge.fromFile));
    const to = moduleByFile.get(toPosix(edge.toFile));
    if (!from || !to || from === to) continue;

    const key = `${from} ${to}`;
    if (!aggregated.has(key)) aggregated.set(key, { from, to, names: [] });
    aggregated.get(key)!.names.push(...edge.importedNames);
  }

  const edges: ArchEdge[] = [];
  for (const { from, to, names } of aggregated.values()) {
    const uniqueNames = dedupe(names);
    edges.push({
      from,
      to,
      type: classifyEdge(from, to, uniqueNames, dirByModule, groups, extractedByPath),
      label: uniqueNames.length > 0 ? listSome(uniqueNames, 3) : undefined,
    });
  }

  return edges.sort((a, b) => (a.from + a.to).localeCompare(b.from + b.to));
}

function classifyEdge(
  from: string,
  to: string,
  importedNames: string[],
  dirByModule: Map<string, string>,
  groups: Map<string, string[]>,
  extractedByPath: Map<string, ExtractedFile>,
): ArchEdge["type"] {
  // A module importing from a directory nested inside it "owns" that submodule
  const fromDir = dirByModule.get(from)!;
  const toDir = dirByModule.get(to)!;
  if (fromDir !== "." && toDir.startsWith(fromDir + "/")) return "owns";

  // If every imported name is a type-only export of the target, the coupling is weak
  const targetValueNames = new Set<string>();
  const targetTypeNames = new Set<string>();
  for (const file of groups.get(toDir) ?? []) {
    const ex = extractedByPath.get(file);
    if (!ex) continue;
    for (const cls of ex.classes) targetValueNames.add(cls.name);
    for (const fn of ex.functions) targetValueNames.add(fn.name);
    for (const exp of ex.exports) {
      if (targetValueNames.has(exp)) continue;
      (isPascalCase(exp) ? targetTypeNames : targetValueNames).add(exp);
    }
  }

  if (
    importedNames.length > 0 &&
    importedNames.every((n) => targetTypeNames.has(n) && !targetValueNames.has(n))
  ) {
    return "weak";
  }

  return "depends";
}
