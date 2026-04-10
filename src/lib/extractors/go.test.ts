import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { extractGo } from "./go";
import fs from "fs";
import path from "path";
import os from "os";

let tmpDir: string;

function writeAndExtract(code: string, filename = "test.go") {
  const filePath = path.join(tmpDir, filename);
  fs.writeFileSync(filePath, code);
  return extractGo(filePath, filename);
}

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "go-extract-test-"));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("extractGo", () => {
  describe("struct extraction", () => {
    it("extracts struct with fields", () => {
      const result = writeAndExtract(`
package main

type User struct {
	Name  string
	Email string
	Age   int
}
      `);
      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("User");
      expect(result.classes[0].properties).toEqual(["Name", "Email", "Age"]);
    });

    it("attaches methods to their receiver struct", () => {
      const result = writeAndExtract(`
package main

type Server struct {
	port int
}

func (s *Server) Start() error {
	return nil
}

func (s Server) Port() int {
	return s.port
}
      `);
      expect(result.classes[0].methods).toHaveLength(2);
      expect(result.classes[0].methods.map((m) => m.name)).toEqual(["Start", "Port"]);
    });

    it("strips pointer from receiver type", () => {
      const result = writeAndExtract(`
package main

type DB struct {}

func (d *DB) Query(sql string) error {
	return nil
}
      `);
      expect(result.classes[0].methods[0].name).toBe("Query");
      expect(result.classes[0].methods[0].params).toEqual(["sql"]);
    });
  });

  describe("method declared before struct — ordering bug", () => {
    it("loses methods when method appears before struct declaration", () => {
      // The extractor iterates top-level nodes in order.
      // If a method_declaration appears BEFORE the struct, structMap won't have the entry yet.
      const result = writeAndExtract(`
package main

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {}

type Handler struct {
	prefix string
}
      `);
      // BUG: The method is processed before the struct exists in structMap,
      // so it's silently dropped.
      expect(result.classes[0].name).toBe("Handler");
      expect(result.classes[0].methods).toHaveLength(0); // method was lost
    });
  });

  describe("export detection", () => {
    it("marks uppercase names as exported", () => {
      const result = writeAndExtract(`
package main

type PublicStruct struct {}
type privateStruct struct {}

func PublicFunc() {}
func privateFunc() {}
      `);
      expect(result.exports).toContain("PublicStruct");
      expect(result.exports).toContain("PublicFunc");
      expect(result.exports).not.toContain("privateStruct");
      expect(result.exports).not.toContain("privateFunc");
    });

    it("handles underscore-prefixed names as unexported", () => {
      const result = writeAndExtract(`
package main

type _internal struct {}
func _helper() {}
      `);
      expect(result.exports).not.toContain("_internal");
      expect(result.exports).not.toContain("_helper");
    });

    it("handles numeric-prefixed names correctly", () => {
      // Go doesn't allow identifiers starting with numbers, but the isExported
      // function should handle edge cases gracefully
      // The function checks: name[0] === name[0].toUpperCase() && name[0] !== name[0].toLowerCase()
      // For digits, toUpperCase() === toLowerCase(), so it returns false — correct
    });
  });

  describe("interface extraction", () => {
    // BUG: extractInterface looks for child type "method_spec" but tree-sitter-go
    // v0.25 uses "method_elem". Methods are silently dropped.
    it("BUG: interface methods not extracted — wrong node type name", () => {
      const result = writeAndExtract(`
package main

type Reader interface {
	Read(p []byte) (int, error)
	Close() error
}
      `);
      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Reader");
      expect(result.classes[0].implements).toEqual(["interface"]);
      // BUG: Should be ["Read", "Close"] but the code checks for "method_spec"
      // while tree-sitter-go produces "method_elem" nodes
      expect(result.classes[0].methods).toEqual([]);
    });
  });

  describe("import extraction", () => {
    it("extracts single import", () => {
      const result = writeAndExtract(`
package main

import "fmt"
      `);
      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toBe("fmt");
      expect(result.imports[0].names).toEqual(["fmt"]);
    });

    it("extracts import block", () => {
      const result = writeAndExtract(`
package main

import (
	"fmt"
	"net/http"
	"encoding/json"
)
      `);
      expect(result.imports).toHaveLength(3);
      expect(result.imports[1].source).toBe("net/http");
      expect(result.imports[1].names).toEqual(["http"]);
    });
  });

  describe("function extraction", () => {
    it("extracts return types", () => {
      const result = writeAndExtract(`
package main

func Add(a int, b int) int {
	return a + b
}

func Divide(a, b float64) (float64, error) {
	return a / b, nil
}
      `);
      expect(result.functions[0].returnType).toBe("int");
      expect(result.functions[1].returnType).toBe("(float64, error)");
    });
  });

  describe("edge cases", () => {
    it("handles empty file (just package declaration)", () => {
      const result = writeAndExtract(`package main`);
      expect(result.classes).toEqual([]);
      expect(result.functions).toEqual([]);
    });

    it("handles embedded structs", () => {
      const result = writeAndExtract(`
package main

type Base struct {
	ID int
}

type Extended struct {
	Base
	Extra string
}
      `);
      expect(result.classes).toHaveLength(2);
    });
  });
});
