import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "tree-sitter",
    "tree-sitter-typescript",
    "tree-sitter-python",
    "tree-sitter-go",
    "tree-sitter-rust",
    "better-sqlite3",
  ],
};

export default nextConfig;
