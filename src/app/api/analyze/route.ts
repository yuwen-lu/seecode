import { NextRequest } from "next/server";
import { parseGitHubUrl, cloneRepo, discoverFiles, detectPrimaryLanguage, cleanupRepo } from "@/lib/repo";
import { extractAll } from "@/lib/extractors";
import { canAnalyzeWithAST } from "@/lib/ast-analyzer";
import { analyzeWithLLMStreaming, analyzeWithHybridStreaming } from "@/lib/llm-analyzer";
import { getCachedGraph, cacheGraph } from "@/lib/cache";
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
        const { owner, repo, cloneUrl } = parseGitHubUrl(url);
        const repoName = `${owner}/${repo}`;
        const cloneResult = cloneRepo(cloneUrl, repo);
        repoDir = cloneResult.repoDir;
        const commitSha = cloneResult.commitSha;

        // Step 2: Check cache
        const cached = getCachedGraph(url, commitSha);
        if (cached) {
          send("status", { step: "cached", message: "Loaded from cache" });
          send("result", cached);
          return;
        }

        const files = discoverFiles(repoDir);
        const primaryLanguage = detectPrimaryLanguage(files);

        if (files.length === 0) {
          send("error", { error: "No source files found in this repository" });
          controller.close();
          return;
        }

        send("status", {
          step: "cloned",
          message: `Found ${files.length} source files (${primaryLanguage})`,
        });

        // Step 3: Tree-sitter extraction
        send("status", { step: "extracting", message: "Extracting code structure..." });
        const extraction = extractAll(files);
        send("status", {
          step: "extracted",
          message: `Parsed ${extraction.files.length} files, found ${extraction.dependencyEdges.length} dependencies`,
        });

        // Step 4: Architecture analysis.
        // Repos in Tree-sitter-supported languages (TS/JS/Python/Go/Rust) use a
        // hybrid workflow: deterministic AST facts first, then LLM semantic
        // refinement with AST fallback. Other languages continue to use the
        // existing LLM analysis over extracted AST summaries/raw snippets.
        let analysis: { modules: ArchGraph["modules"]; edges: ArchGraph["edges"] };

        if (canAnalyzeWithAST(primaryLanguage)) {
          send("status", {
            step: "analyzing",
            message: "Building architecture from AST and refining with Claude...",
          });
          analysis = await analyzeWithHybridStreaming(
            extraction,
            files,
            repoName,
            (chunk: string) => {
              send("chunk", { text: chunk });
            },
            (message: string) => {
              send("status", { step: "analyzing", message });
            },
          );
        } else {
          send("status", { step: "analyzing", message: "Analyzing architecture with Claude..." });
          analysis = await analyzeWithLLMStreaming(
            extraction,
            files,
            repoName,
            (chunk: string) => {
              send("chunk", { text: chunk });
            },
          );
        }

        // Step 5: Build and cache the graph
        const graph: ArchGraph = {
          repoUrl: url,
          repoName,
          commitSha,
          analyzedAt: new Date().toISOString(),
          modules: analysis.modules,
          edges: analysis.edges,
        };

        cacheGraph(graph);
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
