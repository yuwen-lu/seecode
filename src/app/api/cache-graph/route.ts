import { NextRequest } from "next/server";
import { cacheGraph } from "@/lib/cache";
import type { ArchGraph } from "@/types/graph";

export async function POST(request: NextRequest) {
  const graph: ArchGraph = await request.json();

  if (!graph?.repoUrl || !graph?.commitSha) {
    return new Response(JSON.stringify({ error: "Invalid graph" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  cacheGraph(graph);
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
}
