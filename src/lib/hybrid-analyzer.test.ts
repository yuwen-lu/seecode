import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { extractAll } from "./extractors";
import { analyzeWithAST } from "./ast-analyzer";
import { buildHybridPrompt, reconcileLLMWithAST } from "./llm-analyzer";
import type { SourceFile } from "./repo";
import type { ArchEdge, ArchModule } from "@/types/graph";

const fixtures: Record<string, Record<string, string>> = {
  "vercel/next.js-style app router": {
    "packages/next/src/server/app-render.ts": `
      import { renderToHTML } from "../shared/render";
      export async function renderApp(pathname: string) { return renderToHTML(pathname); }
    `,
    "packages/next/src/server/router.ts": `
      import { renderApp } from "./app-render";
      export class AppRouter { async handle(pathname: string) { return renderApp(pathname); } }
    `,
    "packages/next/src/shared/render.ts": `
      export interface RenderResult { html: string }
      export function renderToHTML(pathname: string): RenderResult { return { html: pathname }; }
    `,
    "packages/next/src/client/index.tsx": `
      import { hydrateRoot } from "react-dom/client";
      export function ClientRoot() { hydrateRoot(document.body, null); return null; }
    `,
  },
  "facebook/react-style reconciler": {
    "packages/react/src/React.ts": `
      export function createElement(type: string, props: object) { return { type, props }; }
      export function useState<T>(value: T): [T, (next: T) => void] { return [value, () => {}]; }
    `,
    "packages/react-reconciler/src/ReactFiberWorkLoop.ts": `
      import { createElement } from "../../react/src/React";
      export function performUnitOfWork(type: string) { return createElement(type, {}); }
    `,
    "packages/react-dom/src/client/ReactDOMRoot.ts": `
      import { performUnitOfWork } from "../../react-reconciler/src/ReactFiberWorkLoop";
      export class ReactDOMRoot { render(type: string) { return performUnitOfWork(type); } }
    `,
  },
  "expressjs/express-style middleware stack": {
    "lib/application.js": `
      const Router = require("./router/index");
      function createApplication() { return new Router(); }
      module.exports = { createApplication };
    `,
    "lib/router/index.js": `
      const Layer = require("./layer");
      class Router { use(fn) { return new Layer(fn); } }
      module.exports = Router;
    `,
    "lib/router/layer.js": `
      class Layer { constructor(handle) { this.handle = handle; } match(path) { return Boolean(path); } }
      module.exports = Layer;
    `,
    "lib/request.js": `
      function accepts(type) { return type; }
      module.exports = { accepts };
    `,
  },
};

let tmpRoot = "";

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "seecode-hybrid-"));
});

afterAll(() => {
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("hybrid AST + LLM reconciliation", () => {
  it("asks the LLM to refine a deterministic AST graph instead of replacing source facts", () => {
    const sourceFiles = writeFixture("prompt", fixtures["facebook/react-style reconciler"]);
    const extraction = extractAll(sourceFiles);
    const ast = analyzeWithAST(extraction, sourceFiles);

    const prompt = buildHybridPrompt("## Extracted Structure", ast, "facebook/react");

    expect(prompt).toContain("deterministic graph from Tree-sitter AST parsing");
    expect(prompt).toContain("Every source file from the AST/source summary must appear in exactly one module");
    expect(prompt).toContain(JSON.stringify(ast, null, 2));
  });

  it("keeps every real file exactly once and removes hallucinated files from LLM output", () => {
    const sourceFiles = writeFixture("reconcile", fixtures["vercel/next.js-style app router"]);
    const extraction = extractAll(sourceFiles);
    const ast = analyzeWithAST(extraction, sourceFiles);
    const llm = {
      modules: [
        module({
          id: "rendering-runtime",
          name: "Rendering Runtime",
          category: "core",
          files: [
            "packages/next/src/server/app-render.ts",
            "packages/next/src/shared/render.ts",
            "packages/next/src/shared/render.ts",
            "packages/next/src/imaginary.ts",
          ],
        }),
        module({
          id: "client-entrypoints",
          name: "Client Entrypoints",
          category: "visual",
          files: ["packages/next/src/client/index.tsx"],
        }),
      ],
      edges: [
        { from: "rendering-runtime", to: "missing", type: "depends" as const },
      ],
    };

    const result = reconcileLLMWithAST(llm, ast, extraction, sourceFiles);
    const assigned = result.modules.flatMap((m) => m.files).sort();
    const expected = sourceFiles.map((f) => f.relativePath).sort();

    expect(assigned).toEqual(expected);
    expect(new Set(assigned).size).toBe(expected.length);
    expect(assigned).not.toContain("packages/next/src/imaginary.ts");
    expect(result.edges.every((e) => hasModule(result.modules, e.from) && hasModule(result.modules, e.to)))
      .toBe(true);
  });

  it.each(Object.entries(fixtures) as Array<[string, Record<string, string>]>)(
    "produces canvas-safe hybrid graphs for %s",
    (_repoName: string, files: Record<string, string>) => {
      const sourceFiles = writeFixture(_repoName.replace(/[^a-z0-9]+/gi, "-"), files);
      const extraction = extractAll(sourceFiles);
      const ast = analyzeWithAST(extraction, sourceFiles);
      const llm = semanticLLMGuessFromAST(ast);

      const result = reconcileLLMWithAST(llm, ast, extraction, sourceFiles);

      expect(result.modules.length).toBeGreaterThan(0);
      expect(result.modules.every((m) => m.id && m.name && m.responsibility)).toBe(true);
      expect(result.modules.every((m) => [
        "core", "api-client", "data", "visual", "utility", "config", "external", "proxy", "voice",
      ].includes(m.category))).toBe(true);
      expect(result.modules.flatMap((m) => m.files).sort())
        .toEqual(sourceFiles.map((f) => f.relativePath).sort());
      expect(result.edges.every((e) => hasModule(result.modules, e.from) && hasModule(result.modules, e.to)))
        .toBe(true);
    },
  );
});

function writeFixture(name: string, files: Record<string, string>): SourceFile[] {
  const root = path.join(tmpRoot, name);
  fs.rmSync(root, { recursive: true, force: true });
  const sourceFiles: SourceFile[] = [];

  for (const [relativePath, contents] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, contents.trimStart());
    const extension = path.extname(relativePath);
    sourceFiles.push({
      relativePath,
      absolutePath,
      extension,
      language: extension === ".tsx" || extension === ".ts" ? "typescript" : "javascript",
    });
  }

  return sourceFiles.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function hasModule(modules: ArchModule[], id: string): boolean {
  return modules.some((m) => m.id === id);
}

function module(overrides: Partial<ArchModule>): ArchModule {
  return {
    id: "module",
    name: "Module",
    category: "core",
    responsibility: "Represents a semantic subsystem.",
    files: [],
    keyTypes: [],
    keyMethods: [],
    ...overrides,
  };
}

function semanticLLMGuessFromAST(ast: { modules: ArchModule[]; edges: ArchEdge[] }) {
  const modules = ast.modules.map((m) => module({
    ...m,
    id: `${m.id}-semantic`,
    name: `${m.name} Semantic Layer`,
    responsibility: `Semantic refinement for ${m.name}.`,
  }));
  const idByOld = new Map(ast.modules.map((m, index) => [m.id, modules[index].id]));
  const edges = ast.edges.map((e) => ({
    ...e,
    from: idByOld.get(e.from) ?? e.from,
    to: idByOld.get(e.to) ?? e.to,
    label: e.label ?? "AST dependency",
  }));
  return { modules, edges };
}
