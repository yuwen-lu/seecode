import { NextResponse } from "next/server";
import { listCachedRepos } from "@/lib/cache";

export async function GET() {
  const repos = listCachedRepos();
  return NextResponse.json(repos);
}
