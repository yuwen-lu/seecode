import { NextRequest } from "next/server";
import { ingestRepo, cleanupRepo } from "@/lib/repo";
import { extractAll } from "@/lib/extractors";
import { analyzeWithLLMStreaming } from "@/lib/llm-analyzer";
import type { ArchGraph } from "@/types/graph";

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  let repoDir: string | null = null;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: unknown) {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      }

      try {
        const body = await request.json();
        const url = body?.url;

        if (!url || typeof url !== "string") {
          send("error", { error: "Missing or invalid 'url' field" });
          controller.close();
          return;
        }

        // Step 1: Clone
        send("status", { step: "cloning", message: "Cloning repository..." });
        const repoInfo = ingestRepo(url);
        repoDir = repoInfo.repoDir;

        if (repoInfo.files.length === 0) {
          send("error", { error: "No source files found in this repository" });
          controller.close();
          return;
        }

        send("status", {
          step: "cloned",
          message: `Found ${repoInfo.files.length} source files (${repoInfo.primaryLanguage})`,
        });

        // Step 2: Tree-sitter extraction
        send("status", { step: "extracting", message: "Extracting code structure..." });
        const extraction = extractAll(repoInfo.files);
        send("status", {
          step: "extracted",
          message: `Parsed ${extraction.files.length} files, found ${extraction.dependencyEdges.length} dependencies`,
        });

        // Step 3: LLM analysis (streaming)
        send("status", { step: "analyzing", message: "Analyzing architecture with Claude..." });

        const llmResult = await analyzeWithLLMStreaming(
          extraction,
          repoInfo.files,
          repoInfo.repoName,
          (chunk: string) => {
            send("chunk", { text: chunk });
          },
        );

        // Step 4: Send final graph
        const graph: ArchGraph = {
          repoUrl: url,
          repoName: repoInfo.repoName,
          commitSha: repoInfo.commitSha,
          analyzedAt: new Date().toISOString(),
          modules: llmResult.modules,
          edges: llmResult.edges,
          traces: llmResult.traces,
          mermaid: llmResult.mermaid,
        };

        send("result", graph);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Internal server error";
        console.error("Analysis error:", err);
        send("error", { error: message });
      } finally {
        if (repoDir) {
          cleanupRepo(repoDir);
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
