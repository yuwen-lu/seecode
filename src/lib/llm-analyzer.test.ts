import { describe, it, expect } from "vitest";
import { buildStructureSummary, buildPrompt, parseResponse } from "./llm-analyzer";
import type { ExtractionResult } from "./extractors";
import type { SourceFile } from "./repo";

describe("parseResponse", () => {
  it("parses a well-formed JSON block", () => {
    const text = `Here is the analysis:

\`\`\`json
{
  "modules": [
    {
      "id": "auth",
      "name": "Auth Service",
      "files": ["src/auth.ts"],
      "category": "core",
      "responsibility": "Handles authentication",
      "keyTypes": ["User", "Token"],
      "keyMethods": ["login()", "logout()"]
    }
  ],
  "edges": [
    { "from": "auth", "to": "db", "type": "depends" }
  ],
  "traces": [
    { "name": "login-flow", "description": "User logs in", "path": ["auth", "db"] }
  ]
}
\`\`\``;
    const result = parseResponse(text);
    expect(result.modules).toHaveLength(1);
    expect(result.modules[0].name).toBe("Auth Service");
    expect(result.edges).toHaveLength(1);
    expect(result.traces).toHaveLength(1);
  });

  it("fills in missing keyTypes/keyMethods/files with empty arrays", () => {
    const text = `\`\`\`json
{
  "modules": [
    {
      "id": "minimal",
      "name": "Minimal Module",
      "category": "utility",
      "responsibility": "Does things"
    }
  ],
  "edges": [],
  "traces": []
}
\`\`\``;
    const result = parseResponse(text);
    expect(result.modules[0].keyTypes).toEqual([]);
    expect(result.modules[0].keyMethods).toEqual([]);
    expect(result.modules[0].files).toEqual([]);
  });

  it("handles missing modules/edges/traces fields", () => {
    const text = `\`\`\`json
{}
\`\`\``;
    const result = parseResponse(text);
    expect(result.modules).toEqual([]);
    expect(result.edges).toEqual([]);
    expect(result.traces).toEqual([]);
  });

  it("throws when no JSON block is found", () => {
    expect(() => parseResponse("Just some plain text without any code blocks")).toThrow(
      "did not contain a valid JSON block",
    );
  });

  it("throws on malformed JSON inside code block", () => {
    const text = `\`\`\`json
{ "modules": [INVALID JSON HERE }
\`\`\``;
    expect(() => parseResponse(text)).toThrow("Failed to parse LLM JSON response");
  });

  describe("regex edge cases — potential issues", () => {
    it("handles \\r\\n line endings (Windows-style)", () => {
      const text = "```json\r\n{\"modules\":[], \"edges\":[], \"traces\":[]}\r\n```";
      const result = parseResponse(text);
      expect(result.modules).toEqual([]);
    });

    it("extracts first JSON block when multiple are present", () => {
      const text = `
\`\`\`json
{ "modules": [{"id":"first","name":"First","category":"core","responsibility":"First module"}], "edges": [], "traces": [] }
\`\`\`

\`\`\`json
{ "modules": [{"id":"second","name":"Second","category":"data","responsibility":"Second module"}], "edges": [], "traces": [] }
\`\`\``;
      const result = parseResponse(text);
      expect(result.modules[0].name).toBe("First");
    });

    it("handles JSON with extra whitespace around the block", () => {
      const text = `\`\`\`json
  
  { "modules": [], "edges": [], "traces": [] }
  
\`\`\``;
      const result = parseResponse(text);
      expect(result.modules).toEqual([]);
    });

    it("fails when json block uses triple backticks without 'json' language tag", () => {
      const text = `\`\`\`
{ "modules": [], "edges": [], "traces": [] }
\`\`\``;
      expect(() => parseResponse(text)).toThrow("did not contain a valid JSON block");
    });
  });
});

describe("buildStructureSummary", () => {
  it("includes extracted file structure", () => {
    const extraction: ExtractionResult = {
      files: [
        {
          filePath: "src/app.ts",
          language: "typescript",
          classes: [
            {
              name: "App",
              methods: [{ name: "init", params: [], isAsync: true }],
              properties: ["config"],
            },
          ],
          functions: [{ name: "helper", params: ["x"], returnType: "number" }],
          imports: [{ source: "react", names: ["useState"] }],
          exports: ["App", "helper"],
        },
      ],
      dependencyEdges: [],
    };
    const sourceFiles: SourceFile[] = [];
    const summary = buildStructureSummary(extraction, sourceFiles);

    expect(summary).toContain("src/app.ts [typescript]");
    expect(summary).toContain("class App");
    expect(summary).toContain("async init()");
    expect(summary).toContain("properties: config");
    expect(summary).toContain("function helper(x): number");
    expect(summary).toContain('from "react": useState');
  });

  it("includes dependency edges", () => {
    const extraction: ExtractionResult = {
      files: [
        { filePath: "a.ts", language: "typescript", classes: [], functions: [], imports: [], exports: [] },
        { filePath: "b.ts", language: "typescript", classes: [], functions: [], imports: [], exports: [] },
      ],
      dependencyEdges: [
        { fromFile: "a.ts", toFile: "b.ts", importedNames: ["foo"] },
      ],
    };
    const summary = buildStructureSummary(extraction, []);
    expect(summary).toContain("a.ts → b.ts");
    expect(summary).toContain("foo");
  });

  it("shows class inheritance in summary", () => {
    const extraction: ExtractionResult = {
      files: [{
        filePath: "dog.ts",
        language: "typescript",
        classes: [{
          name: "Dog",
          methods: [],
          properties: [],
          extends: "Animal",
          implements: ["Pet"],
        }],
        functions: [],
        imports: [],
        exports: [],
      }],
      dependencyEdges: [],
    };
    const summary = buildStructureSummary(extraction, []);
    expect(summary).toContain("class Dog extends Animal implements Pet");
  });
});

describe("buildPrompt", () => {
  it("includes repo name and structure summary", () => {
    const prompt = buildPrompt("some code structure here", "owner/repo");
    expect(prompt).toContain("owner/repo");
    expect(prompt).toContain("some code structure here");
    expect(prompt).toContain("modules");
    expect(prompt).toContain("edges");
  });

  it("specifies valid category options", () => {
    const prompt = buildPrompt("", "test/repo");
    expect(prompt).toContain("core");
    expect(prompt).toContain("utility");
    expect(prompt).toContain("dataflow");
  });
});
