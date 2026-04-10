import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { extractRust } from "./rust";
import fs from "fs";
import path from "path";
import os from "os";

let tmpDir: string;

function writeAndExtract(code: string, filename = "test.rs") {
  const filePath = path.join(tmpDir, filename);
  fs.writeFileSync(filePath, code);
  return extractRust(filePath, filename);
}

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rust-extract-test-"));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("extractRust", () => {
  describe("struct extraction", () => {
    it("extracts struct with fields", () => {
      const result = writeAndExtract(`
struct Config {
    host: String,
    port: u16,
}
      `);
      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Config");
      expect(result.classes[0].properties).toEqual(["host", "port"]);
    });

    it("attaches impl methods to struct", () => {
      const result = writeAndExtract(`
struct Counter {
    value: i32,
}

impl Counter {
    fn increment(&mut self) {
        self.value += 1;
    }
    fn get(&self) -> i32 {
        self.value
    }
}
      `);
      expect(result.classes[0].methods).toHaveLength(2);
      expect(result.classes[0].methods.map((m) => m.name)).toEqual(["increment", "get"]);
    });

    it("skips `new` method from impl", () => {
      const result = writeAndExtract(`
struct Foo { x: i32 }

impl Foo {
    fn new(x: i32) -> Self {
        Self { x }
    }
    fn value(&self) -> i32 {
        self.x
    }
}
      `);
      expect(result.classes[0].methods.map((m) => m.name)).not.toContain("new");
      expect(result.classes[0].methods.map((m) => m.name)).toContain("value");
    });
  });

  describe("trait impl", () => {
    it("records trait name in implements", () => {
      const result = writeAndExtract(`
struct MyStruct {}

trait Display {
    fn fmt(&self) -> String;
}

impl Display for MyStruct {
    fn fmt(&self) -> String {
        String::new()
    }
}
      `);
      const myStruct = result.classes.find((c) => c.name === "MyStruct");
      expect(myStruct?.implements).toContain("Display");
    });

    it("creates class if impl appears without prior struct", () => {
      const result = writeAndExtract(`
impl Phantom {
    fn spook(&self) {}
}
      `);
      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Phantom");
      expect(result.classes[0].methods[0].name).toBe("spook");
    });
  });

  describe("enum extraction", () => {
    it("extracts enum variants as properties", () => {
      const result = writeAndExtract(`
pub enum Color {
    Red,
    Green,
    Blue,
}
      `);
      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Color");
      expect(result.classes[0].properties).toEqual(["Red", "Green", "Blue"]);
      expect(result.exports).toContain("Color");
    });
  });

  describe("async detection — potential false negative", () => {
    it("detects pub async fn", () => {
      const result = writeAndExtract(`
pub async fn fetch_data(url: &str) -> Result<String, Error> {
    Ok(String::new())
}
      `);
      expect(result.functions[0].isAsync).toBe(true);
    });

    it("detects plain async fn", () => {
      const result = writeAndExtract(`
async fn do_work() {
}
      `);
      expect(result.functions[0].isAsync).toBe(true);
    });

    it("detects pub(crate) async fn", () => {
      const result = writeAndExtract(`
pub(crate) async fn internal_fetch() -> String {
    String::new()
}
      `);
      expect(result.functions[0].name).toBe("internal_fetch");
      expect(result.functions[0].isAsync).toBe(true);
    });
  });

  describe("use extraction", () => {
    it("extracts simple use", () => {
      const result = writeAndExtract(`
use std::io;
      `);
      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toBe("std");
      expect(result.imports[0].names).toEqual(["io"]);
    });

    it("extracts use with braces", () => {
      const result = writeAndExtract(`
use std::collections::{HashMap, HashSet};
      `);
      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].names).toContain("HashMap");
      expect(result.imports[0].names).toContain("HashSet");
    });

    it("extracts wildcard use", () => {
      const result = writeAndExtract(`
use std::io::*;
      `);
      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].names).toContain("*");
    });
  });

  describe("visibility", () => {
    it("marks pub items as exported", () => {
      const result = writeAndExtract(`
pub struct Public {}
struct Private {}
pub fn public_fn() {}
fn private_fn() {}
      `);
      expect(result.exports).toContain("Public");
      expect(result.exports).toContain("public_fn");
      expect(result.exports).not.toContain("Private");
      expect(result.exports).not.toContain("private_fn");
    });
  });

  describe("self parameter filtering", () => {
    it("filters &self and &mut self from params", () => {
      const result = writeAndExtract(`
struct Foo {}
impl Foo {
    fn method(&self, x: i32) {}
    fn mut_method(&mut self, y: String) {}
}
      `);
      expect(result.classes[0].methods[0].params).toEqual(["x"]);
      expect(result.classes[0].methods[1].params).toEqual(["y"]);
    });
  });

  describe("edge cases", () => {
    it("handles empty file", () => {
      const result = writeAndExtract("");
      expect(result.classes).toEqual([]);
      expect(result.functions).toEqual([]);
    });

    it("handles trait item (abstract methods)", () => {
      const result = writeAndExtract(`
pub trait Serializable {
    fn serialize(&self) -> Vec<u8>;
    fn deserialize(data: &[u8]) -> Self;
}
      `);
      expect(result.classes[0].name).toBe("Serializable");
      expect(result.classes[0].implements).toEqual(["trait"]);
      expect(result.classes[0].methods.map((m) => m.name)).toEqual(["serialize", "deserialize"]);
    });
  });
});
