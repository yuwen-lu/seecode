import Anthropic from "@anthropic-ai/sdk";
import type { ExtractionResult } from "./extractors";
import type { SourceFile } from "./repo";
import type { ArchGraph, ArchModule, ArchEdge } from "@/types/graph";
import fs from "fs";

const client = new Anthropic();

interface LLMAnalysisResult {
  modules: ArchModule[];
  edges: ArchEdge[];
}

export { buildStructureSummary, buildPrompt, parseResponse };

/**
 * Streaming version — yields text chunks as they arrive, then returns the final parsed result.
 */
export async function analyzeWithLLMStreaming(
  extraction: ExtractionResult,
  sourceFiles: SourceFile[],
  repoName: string,
  onChunk: (text: string) => void,
): Promise<LLMAnalysisResult> {
  const structureSummary = buildStructureSummary(extraction, sourceFiles);

  const stream = await client.messages.stream({
    model: "claude-sonnet-4-6",
    max_tokens: 20000,
    messages: [
      {
        role: "user",
        content: buildPrompt(structureSummary, repoName),
      },
    ],
  });

  let fullText = "";
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      fullText += event.delta.text;
      onChunk(event.delta.text);
    }
  }

  const result = parseResponse(fullText);
  enrichModulesWithFiles(result.modules, extraction, sourceFiles);
  return result;
}

function buildStructureSummary(
  extraction: ExtractionResult,
  sourceFiles: SourceFile[],
): string {
  const parts: string[] = [];

  // Files with Tree-sitter extraction
  if (extraction.files.length > 0) {
    parts.push("## Extracted Structure (via AST parsing)\n");
    for (const file of extraction.files) {
      parts.push(`### ${file.filePath} [${file.language}]`);
      if (file.classes.length > 0) {
        for (const cls of file.classes) {
          const ext = cls.extends ? ` extends ${cls.extends}` : "";
          const impl = cls.implements?.length ? ` implements ${cls.implements.join(", ")}` : "";
          parts.push(`  class ${cls.name}${ext}${impl}`);
          for (const m of cls.methods) {
            parts.push(`    ${m.isAsync ? "async " : ""}${m.name}(${m.params.join(", ")})${m.returnType ? `: ${m.returnType}` : ""}`);
          }
          if (cls.properties.length > 0) {
            parts.push(`    properties: ${cls.properties.join(", ")}`);
          }
        }
      }
      if (file.functions.length > 0) {
        for (const fn of file.functions) {
          parts.push(`  ${fn.isAsync ? "async " : ""}function ${fn.name}(${fn.params.join(", ")})${fn.returnType ? `: ${fn.returnType}` : ""}`);
        }
      }
      if (file.imports.length > 0) {
        parts.push(`  imports:`);
        for (const imp of file.imports) {
          parts.push(`    from "${imp.source}": ${imp.names.join(", ") || "(default)"}`);
        }
      }
      parts.push("");
    }

    if (extraction.dependencyEdges.length > 0) {
      parts.push("## Internal Dependencies");
      for (const edge of extraction.dependencyEdges) {
        parts.push(`  ${edge.fromFile} → ${edge.toFile} (imports: ${edge.importedNames.join(", ")})`);
      }
      parts.push("");
    }
  }

  // Files without Tree-sitter extraction — include raw source
  const extractedPaths = new Set(extraction.files.map((f) => f.filePath));
  const unextracted = sourceFiles.filter((f) => !extractedPaths.has(f.relativePath));

  if (unextracted.length > 0) {
    parts.push("## Raw Source Files (no AST extraction available)\n");
    for (const sf of unextracted) {
      try {
        const content = fs.readFileSync(sf.absolutePath, "utf-8");
        // Truncate very large files
        const truncated = content.length > 4000
          ? content.slice(0, 4000) + "\n... (truncated)"
          : content;
        parts.push(`### ${sf.relativePath} [${sf.language}]`);
        parts.push("```");
        parts.push(truncated);
        parts.push("```\n");
      } catch {
        // Skip unreadable files
      }
    }
  }

  return parts.join("\n");
}

function buildPrompt(structureSummary: string, repoName: string): string {
  return `You are analyzing the architecture of the GitHub repository "${repoName}".

Below is the extracted code structure. Analyze it and produce a **structured JSON** object describing modules and edges.

Rules for the JSON:
- Each module should represent a logical component (not every single file — group related files)
- Assign a category to each module. Choose from: core, api-client, data, visual, utility, config, external, proxy, voice
- Write a 1-sentence responsibility description
- List key types (class/struct/interface names) and key methods
- IMPORTANT: Include a "files" array with the EXACT relative file paths from the code structure above (e.g. "src/lib/cache.ts"). Every source file must belong to exactly one module.
- Include lineCount if you can estimate it
- Edges should have a type: "owns" (creates/manages), "depends" (uses), "dataflow" (data passes through), "weak" (optional/loose coupling)

Each module MUST follow this shape:
{ "id": "kebab-case-id", "name": "Human Name", "category": "core", "responsibility": "...", "files": ["src/path/to/file.ts", ...], "keyTypes": [...], "keyMethods": [...] }

Respond in EXACTLY this format (no other text):

\`\`\`json
{
  "modules": [...],
  "edges": [...]
}
\`\`\`

Here is the code structure:

${structureSummary}`;
}

/**
 * Enrich LLM-generated modules with actual file paths and line counts
 * from Tree-sitter extraction data. The LLM often returns empty files arrays,
 * so we match modules to real files by name/type/method overlap.
 */
function enrichModulesWithFiles(
  modules: ArchModule[],
  extraction: ExtractionResult,
  sourceFiles: SourceFile[],
) {
  // Build lookup: for each extracted file, collect all symbol names
  const fileSymbols = new Map<string, Set<string>>();
  const fileLineCounts = new Map<string, number>();

  for (const ef of extraction.files) {
    const symbols = new Set<string>();
    for (const cls of ef.classes) {
      if (cls.name) symbols.add(cls.name.toLowerCase());
      for (const m of cls.methods) {
        if (m.name) symbols.add(m.name.toLowerCase());
      }
    }
    for (const fn of ef.functions) {
      if (fn.name) symbols.add(fn.name.toLowerCase());
    }
    for (const exp of ef.exports) {
      if (exp) symbols.add(exp.toLowerCase());
    }
    fileSymbols.set(ef.filePath, symbols);
  }

  // Also get line counts from raw source files
  for (const sf of sourceFiles) {
    try {
      const content = fs.readFileSync(sf.absolutePath, "utf-8");
      fileLineCounts.set(sf.relativePath, content.split("\n").length);
    } catch {
      // skip
    }
  }

  // Track which files have been assigned
  const assignedFiles = new Set<string>();

  for (const mod of modules) {
    // If the LLM already provided valid files, keep them but still add line counts
    if (mod.files && mod.files.length > 0) {
      // Verify these files actually exist in source (flexible path matching)
      const validFiles = mod.files
        .map((f) => {
          const exact = sourceFiles.find((sf) => sf.relativePath === f);
          if (exact) return exact.relativePath;
          const suffix = sourceFiles.find((sf) => sf.relativePath.endsWith(f) || f.endsWith(sf.relativePath));
          return suffix?.relativePath ?? null;
        })
        .filter((f): f is string => f !== null);
      if (validFiles.length > 0) {
        mod.files = validFiles;
        for (const f of validFiles) assignedFiles.add(f);
        if (!mod.lineCount) {
          mod.lineCount = validFiles.reduce((sum, f) => sum + (fileLineCounts.get(f) ?? 0), 0);
        }
        continue;
      }
    }

    const searchTerms = new Set<string>();
    if (mod.name) searchTerms.add(mod.name.toLowerCase());
    if (mod.id) searchTerms.add(mod.id.toLowerCase().replace(/-/g, ""));
    for (const t of mod.keyTypes) {
      if (t) searchTerms.add(t.toLowerCase());
    }
    for (const m of mod.keyMethods) {
      if (m) searchTerms.add(m.replace(/\(.*\)/, "").toLowerCase());
    }

    const matchedFiles: string[] = [];

    for (const [filePath, symbols] of fileSymbols) {
      if (assignedFiles.has(filePath)) continue;

      let matchScore = 0;
      for (const term of searchTerms) {
        if (symbols.has(term)) matchScore++;
        // Also check if filename contains the module name
        if (filePath.toLowerCase().includes(term)) matchScore += 2;
      }

      if (matchScore > 0) {
        matchedFiles.push(filePath);
      }
    }

    if (matchedFiles.length > 0) {
      mod.files = matchedFiles;
      for (const f of matchedFiles) assignedFiles.add(f);
      mod.lineCount = matchedFiles.reduce((sum, f) => sum + (fileLineCounts.get(f) ?? 0), 0);
    }
  }

  // Second pass: assign any remaining unassigned files to the closest module
  const allFilePaths = sourceFiles.map((sf) => sf.relativePath);
  const unassigned = allFilePaths.filter((f) => !assignedFiles.has(f));

  if (unassigned.length > 0 && modules.length > 0) {
    // Find the "utility" or "config" module to dump unmatched files into
    const utilityMod = modules.find((m) => m.category === "utility" || m.category === "config");
    if (utilityMod) {
      for (const f of unassigned) {
        utilityMod.files.push(f);
        utilityMod.lineCount = (utilityMod.lineCount ?? 0) + (fileLineCounts.get(f) ?? 0);
      }
    }
  }
}

function parseResponse(text: string): LLMAnalysisResult {
  const jsonMatch = text.match(/```json\n([\s\S]*?)```/);
  if (!jsonMatch) {
    throw new Error("LLM response did not contain a valid JSON block");
  }

  let parsed: { modules?: ArchModule[]; edges?: ArchEdge[] };
  try {
    parsed = JSON.parse(jsonMatch[1].trim());
  } catch (err) {
    throw new Error(`Failed to parse LLM JSON response: ${err instanceof Error ? err.message : err}`);
  }

  const modules = (parsed.modules ?? [])
    .filter((m) => m && typeof m === "object")
    .map((m, i) => ({
      ...m,
      id: m.id ?? m.name ?? `module-${i}`,
      name: m.name ?? m.id ?? `Module ${i}`,
      keyTypes: (m.keyTypes ?? []).filter((t): t is string => typeof t === "string"),
      keyMethods: (m.keyMethods ?? []).filter((t): t is string => typeof t === "string"),
      files: (m.files ?? []).filter((f): f is string => typeof f === "string"),
    }));

  return {
    modules,
    edges: (parsed.edges ?? []).filter(
      (e) => e && typeof e.from === "string" && typeof e.to === "string",
    ),
  };
}
