import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { extractPython } from "./python";
import fs from "fs";
import path from "path";
import os from "os";

let tmpDir: string;

function writeAndExtract(code: string, filename = "test.py") {
  const filePath = path.join(tmpDir, filename);
  fs.writeFileSync(filePath, code);
  return extractPython(filePath, filename);
}

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "py-extract-test-"));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("extractPython", () => {
  describe("function extraction", () => {
    it("extracts basic functions", () => {
      const result = writeAndExtract(`
def greet(name):
    return f"Hello {name}"
      `);
      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe("greet");
      expect(result.functions[0].params).toEqual(["name"]);
    });

    it("extracts async functions", () => {
      const result = writeAndExtract(`
async def fetch_data(url):
    return await aiohttp.get(url)
      `);
      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].isAsync).toBe(true);
    });

    it("filters self and cls from params", () => {
      const result = writeAndExtract(`
class Foo:
    def method(self, x, y):
        pass

    @classmethod
    def create(cls, data):
        pass
      `);
      const method = result.classes[0].methods.find((m) => m.name === "method");
      expect(method?.params).toEqual(["x", "y"]);
      const create = result.classes[0].methods.find((m) => m.name === "create");
      expect(create?.params).toEqual(["data"]);
    });

    it("extracts return type annotations", () => {
      const result = writeAndExtract(`
def add(a: int, b: int) -> int:
    return a + b
      `);
      expect(result.functions[0].returnType).toBe("int");
    });
  });

  describe("private function filtering — potential operator precedence bug", () => {
    it("filters single-underscore private functions", () => {
      const result = writeAndExtract(`
def _private_helper():
    pass

def public_function():
    pass
      `);
      // _private_helper should be filtered
      expect(result.functions.map((f) => f.name)).not.toContain("_private_helper");
      expect(result.functions.map((f) => f.name)).toContain("public_function");
    });

    it("keeps __init__ but filters other dunder methods at module level", () => {
      // The code does: name.startsWith("_") && name !== "__init__"
      // This means __str__, __repr__, __eq__ etc. are ALL filtered out
      // This is likely a bug for dunder methods that are important
      const result = writeAndExtract(`
class MyClass:
    def __init__(self, x):
        self.x = x
    def __str__(self):
        return str(self.x)
    def __repr__(self):
        return f"MyClass({self.x})"
    def __eq__(self, other):
        return self.x == other.x
    def get_value(self):
        return self.x
      `);
      const methodNames = result.classes[0].methods.map((m) => m.name);
      // __init__ is specifically excluded from methods (handled separately for properties)
      expect(methodNames).not.toContain("__init__");
      // get_value should be there
      expect(methodNames).toContain("get_value");
      expect(methodNames).toContain("__str__");
      expect(methodNames).toContain("__repr__");
      expect(methodNames).toContain("__eq__");
    });
  });

  describe("class extraction", () => {
    it("extracts class with superclass", () => {
      const result = writeAndExtract(`
class Dog(Animal):
    def bark(self):
        pass
      `);
      expect(result.classes[0].extends).toBe("Animal");
    });

    it("extracts self.x properties from __init__", () => {
      const result = writeAndExtract(`
class User:
    def __init__(self, name, age):
        self.name = name
        self.age = age
        self.active = True
      `);
      expect(result.classes[0].properties).toEqual(["name", "age", "active"]);
    });

    it("does not duplicate properties", () => {
      const result = writeAndExtract(`
class Counter:
    def __init__(self):
        self.count = 0
        self.count = 0
      `);
      // extractSelfProperties checks `!properties.includes(propName)`
      expect(result.classes[0].properties).toEqual(["count"]);
    });

    it("handles decorated class", () => {
      const result = writeAndExtract(`
@dataclass
class Config:
    host: str
    port: int
      `);
      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Config");
    });

    it("handles decorated methods", () => {
      const result = writeAndExtract(`
class Service:
    @staticmethod
    def create():
        pass

    @property
    def name(self):
        return self._name
      `);
      const methodNames = result.classes[0].methods.map((m) => m.name);
      expect(methodNames).toContain("create");
      expect(methodNames).toContain("name");
    });
  });

  describe("import extraction", () => {
    it("extracts simple import", () => {
      const result = writeAndExtract(`
import os
      `);
      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toBe("os");
    });

    it("extracts dotted import", () => {
      const result = writeAndExtract(`
import os.path
      `);
      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toBe("os.path");
      expect(result.imports[0].names).toEqual(["path"]);
    });

    it("extracts from...import", () => {
      const result = writeAndExtract(`
from typing import List, Dict, Optional
      `);
      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toBe("typing");
      expect(result.imports[0].names).toContain("List");
      expect(result.imports[0].names).toContain("Dict");
      expect(result.imports[0].names).toContain("Optional");
    });

    it("handles relative imports", () => {
      const result = writeAndExtract(`
from .utils import helper
from ..models import User
      `);
      expect(result.imports).toHaveLength(2);
    });

    it("handles aliased imports", () => {
      const result = writeAndExtract(`
import numpy as np
from collections import OrderedDict as OD
      `);
      expect(result.imports).toHaveLength(2);
    });
  });

  describe("edge cases", () => {
    it("handles empty file", () => {
      const result = writeAndExtract("");
      expect(result.classes).toEqual([]);
      expect(result.functions).toEqual([]);
    });

    it("handles file with only comments", () => {
      const result = writeAndExtract(`
# This is a comment
"""
This is a docstring at module level
"""
      `);
      expect(result.functions).toEqual([]);
    });

    it("extracts first superclass from multiple inheritance", () => {
      const result = writeAndExtract(`
class MultiChild(Parent1, Parent2, Mixin):
    pass
      `);
      expect(result.classes[0].extends).toBe("Parent1");
    });

    it("extracts typed default parameters", () => {
      const result = writeAndExtract(`
def process(data: list[str], count: int = 5) -> bool:
    return True
      `);
      expect(result.functions[0].params).toEqual(["data", "count"]);
    });
  });
});
