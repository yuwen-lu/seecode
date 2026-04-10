import Anthropic from "@anthropic-ai/sdk";
import type { ArchGraph } from "@/types/graph";
import { githubRawUrl } from "@/types/graph";

export const agentTools: Anthropic.Tool[] = [
  {
    name: "get_module",
    description:
      "Get full details of a specific module including its files, key types, key methods, line count, and responsibility. Use when you need to understand what a module contains or does.",
    input_schema: {
      type: "object" as const,
      properties: {
        moduleId: {
          type: "string",
          description: "The module ID (lowercase-hyphenated, from the module list)",
        },
      },
      required: ["moduleId"],
    },
  },
  {
    name: "get_connections",
    description:
      "Get all edges (dependencies, data flows) to and from a specific module. Returns edge type, direction, and the connected module's name and category. Use when tracing how data flows between modules.",
    input_schema: {
      type: "object" as const,
      properties: {
        moduleId: {
          type: "string",
          description: "The module ID to get connections for",
        },
      },
      required: ["moduleId"],
    },
  },
  {
    name: "read_file",
    description:
      "Read the contents of a source file from the repository. Fetches the file at the exact commit that was analyzed. Use when you need to see actual implementation details, trace function calls, or understand specific code. Files are truncated to ~6000 chars for large files.",
    input_schema: {
      type: "object" as const,
      properties: {
        filePath: {
          type: "string",
          description: "Relative file path from the repo root (e.g. 'src/auth/jwt.ts')",
        },
      },
      required: ["filePath"],
    },
  },
];

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  graph: ArchGraph,
): Promise<string> {
  switch (name) {
    case "get_module": {
      const mod = graph.modules.find((m) => m.id === input.moduleId);
      if (!mod) return `Module not found: ${input.moduleId}`;
      return JSON.stringify({
        id: mod.id,
        name: mod.name,
        category: mod.category,
        responsibility: mod.responsibility,
        files: mod.files,
        keyTypes: mod.keyTypes,
        keyMethods: mod.keyMethods,
        lineCount: mod.lineCount,
      });
    }

    case "get_connections": {
      const edges = graph.edges.filter(
        (e) => e.from === input.moduleId || e.to === input.moduleId,
      );
      if (edges.length === 0) return `No connections found for: ${input.moduleId}`;
      return JSON.stringify(
        edges.map((e) => {
          const isSource = e.from === input.moduleId;
          const otherId = isSource ? e.to : e.from;
          const other = graph.modules.find((m) => m.id === otherId);
          return {
            type: e.type,
            label: e.label,
            direction: isSource ? "outgoing" : "incoming",
            connectedModule: other
              ? { id: other.id, name: other.name, category: other.category }
              : { id: otherId },
          };
        }),
      );
    }

    case "read_file": {
      const filePath = input.filePath as string;
      const url = githubRawUrl(graph.repoUrl, graph.commitSha, filePath);
      if (!url) return `Cannot construct URL for: ${filePath}`;
      try {
        const resp = await fetch(url);
        if (!resp.ok) return `File not found (${resp.status}): ${filePath}`;
        const content = await resp.text();
        const MAX_CHARS = 6000;
        if (content.length > MAX_CHARS) {
          return content.slice(0, MAX_CHARS) + `\n... (truncated, ${content.length} chars total)`;
        }
        return content;
      } catch (err) {
        return `Error fetching file: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    default:
      return `Unknown tool: ${name}`;
  }
}

export function buildAgentSystemPrompt(graph: ArchGraph): string {
  const moduleList = graph.modules
    .map((m) => `- ${m.name} (id: ${m.id}) [${m.category}]: ${m.responsibility}`)
    .join("\n");

  return `You are an AI assistant helping a developer understand the architecture of a GitHub repository. The developer is viewing an interactive graph visualization of the codebase.

Repository: ${graph.repoName} (${graph.repoUrl})
Commit: ${graph.commitSha}

## Available Modules
${moduleList}

## How to Work
You have tools to explore the codebase. Use them to gather information before answering.
- Use get_module to inspect a module's files, types, and methods
- Use get_connections to trace data flow and dependencies between modules
- Use read_file to see actual source code when you need implementation details

Be thorough but efficient — read the files and connections you need, then give a clear answer.

## Response Format
- Be concise and direct.
- When referencing files, use their exact paths.
- When the user asks about data flows, processes, or "what happens when...", construct a trace.

At the very end of your response, include BOTH of these blocks on their own lines:
1. Module references: <!--refs:["module-id-1","module-id-2"]-->
2. If you identified a data flow / trace: <!--trace:{"name":"short name","steps":[{"moduleId":"id","summary":"what happens here","files":["relevant/file.ts"],"dataIn":"input data","dataOut":"output data"},...]}--> 

Only include the trace block when the user is asking about a flow, process, or how something works end-to-end. The steps should use ONLY module IDs from the Available Modules list above.`;
}
