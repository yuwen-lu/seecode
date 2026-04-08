import Parser from "tree-sitter";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const RustLanguage = require("tree-sitter-rust");
import fs from "fs";
import type { ExtractedFile, ExtractedClass, ExtractedFunction, ExtractedImport } from "./types";

const parser = new Parser();
parser.setLanguage(RustLanguage as Parser.Language);

export function extractRust(filePath: string, relativePath: string): ExtractedFile {
  const source = fs.readFileSync(filePath, "utf-8");
  const tree = parser.parse(source);
  const root = tree.rootNode;

  const classes: ExtractedClass[] = [];
  const functions: ExtractedFunction[] = [];
  const imports: ExtractedImport[] = [];
  const exports: string[] = [];

  // Map struct names to their classes so impl blocks can add methods
  const structMap = new Map<string, ExtractedClass>();

  for (let i = 0; i < root.childCount; i++) {
    const node = root.child(i)!;

    if (node.type === "struct_item") {
      const cls = extractStruct(node);
      if (cls) {
        structMap.set(cls.name, cls);
        classes.push(cls);
        if (isPub(node)) exports.push(cls.name);
      }
    } else if (node.type === "enum_item") {
      const name = node.childForFieldName("name")?.text;
      if (name) {
        const cls: ExtractedClass = { name, methods: [], properties: extractEnumVariants(node) };
        structMap.set(name, cls);
        classes.push(cls);
        if (isPub(node)) exports.push(name);
      }
    } else if (node.type === "trait_item") {
      const cls = extractTrait(node);
      if (cls) {
        classes.push(cls);
        if (isPub(node)) exports.push(cls.name);
      }
    } else if (node.type === "impl_item") {
      extractImpl(node, structMap, classes);
    } else if (node.type === "function_item") {
      const fn = extractFunction(node);
      if (fn) {
        functions.push(fn);
        if (isPub(node)) exports.push(fn.name);
      }
    } else if (node.type === "use_declaration") {
      const imp = extractUse(node);
      if (imp) imports.push(imp);
    }
  }

  return { filePath: relativePath, language: "rust", classes, functions, imports, exports };
}

function extractStruct(node: Parser.SyntaxNode): ExtractedClass | null {
  const name = node.childForFieldName("name")?.text;
  if (!name) return null;

  const properties: string[] = [];
  const body = node.childForFieldName("body") ?? findChild(node, ["field_declaration_list"]);
  if (body) {
    for (let i = 0; i < body.childCount; i++) {
      const field = body.child(i)!;
      if (field.type === "field_declaration") {
        const fieldName = field.childForFieldName("name")?.text;
        if (fieldName) properties.push(fieldName);
      }
    }
  }

  return { name, methods: [], properties };
}

function extractTrait(node: Parser.SyntaxNode): ExtractedClass | null {
  const name = node.childForFieldName("name")?.text;
  if (!name) return null;

  const methods: ExtractedFunction[] = [];
  const body = node.childForFieldName("body") ?? findChild(node, ["declaration_list"]);
  if (body) {
    for (let i = 0; i < body.childCount; i++) {
      const item = body.child(i)!;
      if (item.type === "function_signature_item" || item.type === "function_item") {
        const fn = extractFunction(item);
        if (fn) methods.push(fn);
      }
    }
  }

  return { name, methods, properties: [], implements: ["trait"] };
}

function extractImpl(
  node: Parser.SyntaxNode,
  structMap: Map<string, ExtractedClass>,
  classes: ExtractedClass[],
) {
  const typeName = node.childForFieldName("type")?.text;
  if (!typeName) return;

  const body = node.childForFieldName("body") ?? findChild(node, ["declaration_list"]);
  if (!body) return;

  // Find or create the class
  let cls = structMap.get(typeName);
  if (!cls) {
    cls = { name: typeName, methods: [], properties: [] };
    structMap.set(typeName, cls);
    classes.push(cls);
  }

  // Check if this is a trait impl: impl Trait for Type
  const trait = node.childForFieldName("trait");
  if (trait) {
    if (!cls.implements) cls.implements = [];
    cls.implements.push(trait.text);
  }

  for (let i = 0; i < body.childCount; i++) {
    const item = body.child(i)!;
    if (item.type === "function_item") {
      const fn = extractFunction(item);
      if (fn && fn.name !== "new") {
        cls.methods.push(fn);
      }
    }
  }
}

function extractFunction(node: Parser.SyntaxNode): ExtractedFunction | null {
  const name = node.childForFieldName("name")?.text;
  if (!name) return null;

  const params = extractParams(node);
  const returnType = extractReturnType(node);
  const isAsync = nodeContains(node, "async");

  return { name, params, returnType, isAsync };
}

function extractParams(node: Parser.SyntaxNode): string[] {
  const paramList = node.childForFieldName("parameters");
  if (!paramList) return [];

  const params: string[] = [];
  for (let i = 0; i < paramList.childCount; i++) {
    const param = paramList.child(i)!;
    if (param.type === "parameter") {
      const name = param.childForFieldName("pattern")?.text;
      if (name && name !== "self" && name !== "&self" && name !== "&mut self") {
        params.push(name);
      }
    } else if (param.type === "self_parameter") {
      // Skip self
    }
  }
  return params;
}

function extractReturnType(node: Parser.SyntaxNode): string | undefined {
  const ret = node.childForFieldName("return_type");
  if (ret) {
    // Skip the "-> " part
    return ret.text.replace(/^->\s*/, "");
  }
  return undefined;
}

function extractUse(node: Parser.SyntaxNode): ExtractedImport | null {
  // use foo::bar::{Baz, Qux};
  const argument = node.childForFieldName("argument") ?? findChild(node, ["use_wildcard", "use_list", "scoped_identifier", "identifier", "use_as_clause"]);
  if (!argument) return null;

  const text = argument.text;
  const parts = text.split("::");
  const source = parts.slice(0, -1).join("::");
  const last = parts[parts.length - 1];

  // Handle use lists: {A, B, C}
  if (last.startsWith("{") && last.endsWith("}")) {
    const names = last.slice(1, -1).split(",").map((n) => n.trim()).filter(Boolean);
    return { source: source || text, names };
  }

  return { source: source || text, names: [last.replace(/^\*$/, "*")] };
}

function extractEnumVariants(node: Parser.SyntaxNode): string[] {
  const variants: string[] = [];
  const body = node.childForFieldName("body") ?? findChild(node, ["enum_variant_list"]);
  if (body) {
    for (let i = 0; i < body.childCount; i++) {
      const variant = body.child(i)!;
      if (variant.type === "enum_variant") {
        const name = variant.childForFieldName("name")?.text;
        if (name) variants.push(name);
      }
    }
  }
  return variants;
}

function isPub(node: Parser.SyntaxNode): boolean {
  for (let i = 0; i < node.childCount; i++) {
    if (node.child(i)!.type === "visibility_modifier") return true;
  }
  return false;
}

function nodeContains(node: Parser.SyntaxNode, keyword: string): boolean {
  return node.text.startsWith(keyword + " ") || node.text.startsWith("pub " + keyword + " ");
}

function findChild(node: Parser.SyntaxNode, types: string[]): Parser.SyntaxNode | null {
  for (let i = 0; i < node.childCount; i++) {
    if (types.includes(node.child(i)!.type)) return node.child(i)!;
  }
  return null;
}
