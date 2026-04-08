import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "tree-sitter",
    "tree-sitter-typescript",
    "tree-sitter-python",
    "tree-sitter-go",
    "tree-sitter-rust",
  ],
};

export default nextConfig;
