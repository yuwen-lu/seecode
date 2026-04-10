import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { CanvasContext } from "@/types/chat";
import { getCachedGraph, getLatestCachedGraph } from "@/lib/cache";
import { agentTools, executeTool, buildAgentSystemPrompt } from "@/lib/agent-tools";
import type { ArchGraph } from "@/types/graph";

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic();
  return _client;
}

export const maxDuration = 120;

const MAX_ITERATIONS = 15;

interface ChatRequestBody {
  message: string;
  context: CanvasContext;
  history: { role: "user" | "assistant"; content: string }[];
}

function resolveGraph(ctx: CanvasContext): ArchGraph | null {
  const exact = getCachedGraph(ctx.repoUrl, ctx.commitSha);
  if (exact) return exact;
  return getLatestCachedGraph(ctx.repoUrl);
}

function buildContextHint(ctx: CanvasContext): string {
  const parts: string[] = [];
  if (ctx.selected) {
    parts.push(`The developer currently has module "${ctx.selected.name}" (id: ${ctx.selected.id}) selected on the canvas.`);
  } else if (ctx.selectedComponent) {
    parts.push(`The developer currently has the "${ctx.selectedComponent.label}" component group selected, containing: ${ctx.selectedComponent.members.map((m) => m.name).join(", ")}.`);
  }
  return parts.length > 0 ? `\n\nContext: ${parts.join(" ")}` : "";
}

export async function POST(request: NextRequest) {
  const body: ChatRequestBody = await request.json();
  const { message, context, history } = body;

  if (!message || typeof message !== "string") {
    return new Response(JSON.stringify({ error: "Missing message" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  let client: Anthropic;
  try {
    client = getClient();
  } catch {
    return new Response(
      JSON.stringify({ error: "Anthropic API key not configured. Set ANTHROPIC_API_KEY in your environment." }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const graph = resolveGraph(context);
  if (!graph) {
    return new Response(JSON.stringify({ error: "Graph not found in cache" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const systemPrompt = buildAgentSystemPrompt(graph);
  const contextHint = buildContextHint(context);
  const safeHistory = Array.isArray(history) ? history : [];

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: unknown) {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      }

      try {
        const messages: Anthropic.MessageParam[] = [
          ...safeHistory.map((h) => ({
            role: h.role as "user" | "assistant",
            content: h.content,
          })),
          { role: "user", content: message + contextHint },
        ];

        let iterations = 0;
        let fullText = "";

        while (iterations++ < MAX_ITERATIONS) {
          const response = await client.messages.create({
            model: "claude-sonnet-4-6",
            max_tokens: 4096,
            system: systemPrompt,
            tools: agentTools,
            messages,
          });

          const toolUseBlocks: Anthropic.ContentBlockParam[] = [];
          const toolResultBlocks: Anthropic.ToolResultBlockParam[] = [];

          for (const block of response.content) {
            if (block.type === "text") {
              fullText += block.text;
              send("chunk", { text: block.text });
            }

            if (block.type === "tool_use") {
              const toolInput = block.input as Record<string, unknown>;
              send("tool_call", {
                tool: block.name,
                input: toolInput,
              });

              const result = await executeTool(block.name, toolInput, graph);

              const summary =
                result.length > 200
                  ? result.slice(0, 200) + "..."
                  : result;
              send("tool_result", {
                tool: block.name,
                summary,
              });

              toolUseBlocks.push({
                type: "tool_use",
                id: block.id,
                name: block.name,
                input: block.input,
              } as Anthropic.ContentBlockParam);

              toolResultBlocks.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: result,
              });
            }
          }

          if (response.stop_reason === "end_turn") break;

          if (toolResultBlocks.length > 0) {
            messages.push({
              role: "assistant",
              content: response.content.map((b) => {
                if (b.type === "text") return { type: "text" as const, text: b.text };
                if (b.type === "tool_use")
                  return {
                    type: "tool_use" as const,
                    id: b.id,
                    name: b.name,
                    input: b.input,
                  };
                return b;
              }),
            });
            messages.push({
              role: "user",
              content: toolResultBlocks,
            });
          } else {
            break;
          }
        }

        const refsMatch = fullText.match(/<!--refs:\s*(\[[\s\S]*?\])\s*-->/);
        let refs: string[] = [];
        if (refsMatch) {
          try {
            refs = JSON.parse(refsMatch[1]);
          } catch {}
        }

        const traceMatch = fullText.match(/<!--trace:\s*(\{[\s\S]*?\})\s*-->/);
        let trace = null;
        if (traceMatch) {
          try {
            trace = JSON.parse(traceMatch[1]);
          } catch {}
        }

        const cleanContent = fullText
          .replace(/<!--refs:\s*\[[\s\S]*?\]\s*-->\s*/g, "")
          .replace(/<!--trace:\s*\{[\s\S]*?\}\s*-->\s*/g, "")
          .trim();

        send("done", { content: cleanContent, refs, trace });
      } catch (err) {
        const errMsg =
          err instanceof Error ? err.message : "Internal server error";
        console.error("Chat error:", err);
        send("error", { error: errMsg });
      } finally {
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
