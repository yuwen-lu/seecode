import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { extractTypeScript } from "./typescript";
import fs from "fs";
import path from "path";
import os from "os";

let tmpDir: string;

function writeAndExtract(code: string, filename = "test.ts") {
  const filePath = path.join(tmpDir, filename);
  fs.writeFileSync(filePath, code);
  return extractTypeScript(filePath, filename);
}

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ts-extract-test-"));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("extractTypeScript", () => {
  describe("function extraction", () => {
    it("extracts named exported functions", () => {
      const result = writeAndExtract(`
export function greet(name: string): string {
  return "Hello " + name;
}
      `);
      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe("greet");
      expect(result.functions[0].params).toEqual(["name"]);
      expect(result.functions[0].returnType).toBe("string");
      expect(result.exports).toContain("greet");
    });

    it("detects async functions", () => {
      const result = writeAndExtract(`
export async function fetchData(url: string): Promise<string> {
  return await fetch(url).then(r => r.text());
}
      `);
      expect(result.functions[0].isAsync).toBe(true);
    });

    it("extracts arrow functions assigned to const", () => {
      const result = writeAndExtract(`
export const add = (a: number, b: number): number => a + b;
      `);
      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe("add");
      expect(result.functions[0].params).toEqual(["a", "b"]);
    });

    it("handles non-exported arrow functions", () => {
      const result = writeAndExtract(`
const helper = (x: number) => x * 2;
      `);
      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe("helper");
      expect(result.exports).not.toContain("helper");
    });

    it("handles function with no parameters", () => {
      const result = writeAndExtract(`
export function noop(): void {}
      `);
      expect(result.functions[0].params).toEqual([]);
    });

    it("handles function with destructured parameters", () => {
      const result = writeAndExtract(`
function process({ name, age }: { name: string; age: number }) {
  return name;
}
      `);
      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe("process");
    });
  });

  describe("class extraction", () => {
    it("extracts class with methods and properties", () => {
      const result = writeAndExtract(`
export class UserService {
  private db: Database;
  
  async getUser(id: string): Promise<User> {
    return this.db.find(id);
  }
  
  deleteUser(id: string): void {
    this.db.delete(id);
  }
}
      `);
      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("UserService");
      expect(result.classes[0].methods.map((m) => m.name)).toEqual(["getUser", "deleteUser"]);
      expect(result.classes[0].methods[0].isAsync).toBe(true);
    });

    it("filters out constructor from methods", () => {
      const result = writeAndExtract(`
class Foo {
  constructor(private x: number) {}
  getValue(): number { return this.x; }
}
      `);
      const methodNames = result.classes[0].methods.map((m) => m.name);
      expect(methodNames).not.toContain("constructor");
      expect(methodNames).toContain("getValue");
    });

    it("extracts extends and implements", () => {
      const result = writeAndExtract(`
class Dog extends Animal implements Pet, Trainable {
  bark(): void {}
}
      `);
      expect(result.classes[0].extends).toBe("Animal");
      expect(result.classes[0].implements).toEqual(["Pet", "Trainable"]);
    });

    it("handles class with no body members", () => {
      const result = writeAndExtract(`
class Empty {}
      `);
      expect(result.classes[0].name).toBe("Empty");
      expect(result.classes[0].methods).toEqual([]);
      expect(result.classes[0].properties).toEqual([]);
    });
  });

  describe("import extraction", () => {
    // BUG: findChildByTypes(node, ["import_clause", "named_imports"]) finds
    // import_clause (the parent wrapper) instead of named_imports (nested inside it).
    // Then it iterates import_clause's children looking for import_specifier nodes,
    // but import_clause contains named_imports, not import_specifier directly.
    // Result: named import identifiers are silently lost.
    it("BUG: named imports are not extracted — names array is empty", () => {
      const result = writeAndExtract(`
import { useState, useEffect } from "react";
      `);
      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toBe("react");
      // BUG: Should contain ["useState", "useEffect"] but returns []
      expect(result.imports[0].names).toEqual([]);
    });

    // BUG: findChildByTypes(node, ["identifier"]) searches direct children of
    // import_statement, but for `import React from "react"`, the identifier
    // "React" is inside import_clause, not a direct child of import_statement.
    it("BUG: default import names are not extracted", () => {
      const result = writeAndExtract(`
import React from "react";
      `);
      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toBe("react");
      // BUG: Should contain ["React"] with isDefault: true
      expect(result.imports[0].names).toEqual([]);
    });

    it("handles side-effect-only imports", () => {
      const result = writeAndExtract(`
import "./styles.css";
      `);
      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toBe("./styles.css");
    });

    it("BUG: aliased import names are not extracted", () => {
      const result = writeAndExtract(`
import { Component as Comp } from "./component";
      `);
      expect(result.imports).toHaveLength(1);
      // BUG: Same root cause as named imports — names are empty
      expect(result.imports[0].names).toEqual([]);
    });
  });

  describe("export extraction", () => {
    it("captures exported interfaces and type aliases", () => {
      const result = writeAndExtract(`
export interface User {
  name: string;
  age: number;
}

export type ID = string | number;
      `);
      expect(result.exports).toContain("User");
      expect(result.exports).toContain("ID");
    });

    it("captures exported const that is NOT a function", () => {
      const result = writeAndExtract(`
export const API_URL = "https://api.example.com";
      `);
      expect(result.exports).toContain("API_URL");
      expect(result.functions).toHaveLength(0);
    });
  });

  describe("TSX handling", () => {
    it("parses JSX in .tsx files without errors", () => {
      const result = writeAndExtract(`
import React from "react";

export function Button({ label }: { label: string }) {
  return <button className="btn">{label}</button>;
}
      `, "Button.tsx");
      expect(result.language).toBe("tsx");
      expect(result.functions[0].name).toBe("Button");
    });

    it("parses .jsx as tsx", () => {
      const result = writeAndExtract(`
export function App() {
  return <div>Hello</div>;
}
      `, "App.jsx");
      expect(result.language).toBe("tsx");
    });
  });

  describe("edge cases", () => {
    it("handles empty file", () => {
      const result = writeAndExtract("");
      expect(result.classes).toEqual([]);
      expect(result.functions).toEqual([]);
      expect(result.imports).toEqual([]);
      expect(result.exports).toEqual([]);
    });

    it("handles file with only comments", () => {
      const result = writeAndExtract(`
// This is a comment
/* Multi-line
   comment */
      `);
      expect(result.functions).toEqual([]);
    });

    it("handles re-exports", () => {
      const result = writeAndExtract(`
export { foo } from "./foo";
export { default as Bar } from "./bar";
      `);
      // re-exports are export_statements — they should at least not crash
      expect(result).toBeDefined();
    });

    it("handles multiple declarations in one const statement", () => {
      const result = writeAndExtract(`
export const a = 1, b = "hello", c = () => {};
      `);
      expect(result.exports).toContain("a");
      expect(result.exports).toContain("b");
      expect(result.exports).toContain("c");
      expect(result.functions.map((f) => f.name)).toContain("c");
    });
  });
});
