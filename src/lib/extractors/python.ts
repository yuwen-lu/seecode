import Parser from "tree-sitter";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PythonLanguage = require("tree-sitter-python");
import fs from "fs";
import type { ExtractedFile, ExtractedClass, ExtractedFunction, ExtractedImport } from "./types";

const parser = new Parser();
parser.setLanguage(PythonLanguage as Parser.Language);

export function extractPython(filePath: string, relativePath: string): ExtractedFile {
  const source = fs.readFileSync(filePath, "utf-8");
  const tree = parser.parse(source);
  const root = tree.rootNode;

  const classes: ExtractedClass[] = [];
  const functions: ExtractedFunction[] = [];
  const imports: ExtractedImport[] = [];
  const exports: string[] = [];

  for (let i = 0; i < root.childCount; i++) {
    const node = root.child(i)!;

    if (node.type === "class_definition") {
      const cls = extractClass(node);
      if (cls) {
        classes.push(cls);
        exports.push(cls.name);
      }
    } else if (node.type === "function_definition") {
      const fn = extractFunction(node);
      if (fn) {
        functions.push(fn);
        exports.push(fn.name);
      }
    } else if (node.type === "import_statement") {
      const imp = parseImport(node);
      if (imp) imports.push(imp);
    } else if (node.type === "import_from_statement") {
      const imp = parseFromImport(node);
      if (imp) imports.push(imp);
    } else if (node.type === "decorated_definition") {
      // Handle @decorator\ndef ... or @decorator\nclass ...
      const inner = findChild(node, ["class_definition", "function_definition"]);
      if (inner?.type === "class_definition") {
        const cls = extractClass(inner);
        if (cls) { classes.push(cls); exports.push(cls.name); }
      } else if (inner?.type === "function_definition") {
        const fn = extractFunction(inner);
        if (fn) { functions.push(fn); exports.push(fn.name); }
      }
    }
  }

  return { filePath: relativePath, language: "python", classes, functions, imports, exports };
}

function extractClass(node: Parser.SyntaxNode): ExtractedClass | null {
  const name = node.childForFieldName("name")?.text;
  if (!name) return null;

  const methods: ExtractedFunction[] = [];
  const properties: string[] = [];
  let extendsName: string | undefined;

  // Superclass — argument_list children include punctuation, skip them
  const superclasses = node.childForFieldName("superclasses");
  if (superclasses) {
    for (let k = 0; k < superclasses.childCount; k++) {
      const arg = superclasses.child(k)!;
      if (arg.type !== "(" && arg.type !== ")" && arg.type !== ",") {
        extendsName = arg.text;
        break;
      }
    }
  }

  const body = node.childForFieldName("body");
  if (body) {
    for (let i = 0; i < body.childCount; i++) {
      const member = body.child(i)!;
      if (member.type === "function_definition") {
        const fn = extractFunction(member);
        if (fn && fn.name !== "__init__") {
          methods.push(fn);
        } else if (fn?.name === "__init__") {
          // Extract properties from self.x assignments in __init__
          const initBody = member.childForFieldName("body");
          if (initBody) extractSelfProperties(initBody, properties);
        }
      } else if (member.type === "decorated_definition") {
        const inner = findChild(member, ["function_definition"]);
        if (inner) {
          const fn = extractFunction(inner);
          if (fn && fn.name !== "__init__") methods.push(fn);
        }
      }
    }
  }

  return { name, methods, properties, extends: extendsName };
}

function extractFunction(node: Parser.SyntaxNode): ExtractedFunction | null {
  const name = node.childForFieldName("name")?.text;
  if (!name || (name.startsWith("_") && !name.startsWith("__"))) return null;

  const paramsNode = node.childForFieldName("parameters");
  const params: string[] = [];
  if (paramsNode) {
    for (let i = 0; i < paramsNode.childCount; i++) {
      const p = paramsNode.child(i)!;
      if (p.type === "identifier" && p.text !== "self" && p.text !== "cls") {
        params.push(p.text);
      } else if (p.type === "typed_parameter" || p.type === "default_parameter" || p.type === "typed_default_parameter") {
        const pName = p.child(0)?.text;
        if (pName && pName !== "self" && pName !== "cls") params.push(pName);
      }
    }
  }

  const returnAnnotation = node.childForFieldName("return_type");
  const returnType = returnAnnotation?.text?.replace(/^\s*->\s*/, "");

  const isAsync = node.previousSibling?.type === "async" ||
    node.text.startsWith("async ");

  return { name, params, returnType, isAsync };
}

function parseImport(node: Parser.SyntaxNode): ExtractedImport | null {
  // import foo / import foo.bar
  const nameNode = findChild(node, ["dotted_name", "aliased_import"]);
  if (!nameNode) return null;
  const source = nameNode.type === "aliased_import"
    ? nameNode.child(0)?.text ?? nameNode.text
    : nameNode.text;
  return { source, names: [source.split(".").pop() ?? source] };
}

function parseFromImport(node: Parser.SyntaxNode): ExtractedImport | null {
  // from foo import bar, baz
  const moduleNode = node.childForFieldName("module_name") ??
    findChild(node, ["dotted_name", "relative_import"]);
  if (!moduleNode) return null;
  const source = moduleNode.text;

  const names: string[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)!;
    if (child.type === "dotted_name" && child !== moduleNode) {
      names.push(child.text);
    } else if (child.type === "aliased_import") {
      names.push(child.child(0)?.text ?? child.text);
    }
  }

  return { source, names };
}

function extractSelfProperties(body: Parser.SyntaxNode, properties: string[]) {
  for (let i = 0; i < body.childCount; i++) {
    const stmt = body.child(i)!;
    if (stmt.type === "expression_statement") {
      const expr = stmt.child(0);
      if (expr?.type === "assignment") {
        const left = expr.childForFieldName("left") ?? expr.child(0);
        if (left?.type === "attribute" && left.child(0)?.text === "self") {
          const propName = left.childForFieldName("attribute")?.text ?? left.child(2)?.text;
          if (propName && !properties.includes(propName)) {
            properties.push(propName);
          }
        }
      }
    }
  }
}

function findChild(node: Parser.SyntaxNode, types: string[]): Parser.SyntaxNode | null {
  for (let i = 0; i < node.childCount; i++) {
    if (types.includes(node.child(i)!.type)) return node.child(i)!;
  }
  return null;
}
