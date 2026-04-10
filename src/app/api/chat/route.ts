import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { CanvasContext } from "@/types/chat";
import { serializeForPrompt } from "@/lib/canvas-context";

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic();
  return _client;
}

export const maxDuration = 60;

interface ChatRequestBody {
  message: string;
  context: CanvasContext;
  history: { role: "user" | "assistant"; content: string }[];
}

function buildSystemPrompt(ctx: CanvasContext): string {
  const contextBlock = serializeForPrompt(ctx);

  return `You are an AI assistant helping a developer understand the architecture of a GitHub repository. The developer is viewing an interactive graph visualization of the codebase.

${contextBlock}

## Instructions
- The developer may have a module or component group selected on the canvas. FOCUS YOUR ANSWER ON WHAT IS SELECTED.
- A "Selected Module" means a single module is selected — answer about that module specifically.
- A "Selected Component" means a group of related modules is selected at the system level — answer about that component and its constituent modules.
- If they ask "what is this" or "what does this do", answer about what is currently SELECTED, not the whole repo.
- If nothing is selected, answer based on the overall architecture.
- When relevant, show code snippets inline and reference specific file paths.
- When referencing files, use their exact paths from the module file lists above.
- Be concise and direct. No need for headers or long introductions.
- At the very end of your response, on its own line, include a structured reference block using module IDs (the lowercase-hyphenated identifiers shown in parentheses after each module name, NOT display names). Format: <!--refs:["module-id-1","module-id-2"]-->
  Only include modules directly relevant to your answer.`;
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

  const systemPrompt = buildSystemPrompt(context);
  const safeHistory = Array.isArray(history) ? history : [];
  const messages: Anthropic.MessageParam[] = [
    ...safeHistory.map((h) => ({ role: h.role as "user" | "assistant", content: h.content })),
    { role: "user", content: message },
  ];

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: unknown) {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      }

      try {
        const anthropicStream = await client.messages.stream({
          model: "claude-haiku-4-5",
          max_tokens: 4096,
          system: systemPrompt,
          messages,
        });

        let fullText = "";
        for await (const event of anthropicStream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            fullText += event.delta.text;
            send("chunk", { text: event.delta.text });
          }
        }

        const refsMatch = fullText.match(/<!--refs:\s*(\[.*?\])\s*-->/);
        let refs: string[] = [];
        if (refsMatch) {
          try { refs = JSON.parse(refsMatch[1]); } catch {}
        }

        const cleanContent = fullText.replace(/<!--refs:\s*\[.*?\]\s*-->\s*$/, "").trim();
        send("done", { content: cleanContent, refs });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "Internal server error";
        console.error("Chat error:", err);
        send("error", { error: errMsg });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}
