import Parser from "tree-sitter";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const GoLanguage = require("tree-sitter-go");
import fs from "fs";
import type { ExtractedFile, ExtractedClass, ExtractedFunction, ExtractedImport } from "./types";

const parser = new Parser();
parser.setLanguage(GoLanguage as Parser.Language);

export function extractGo(filePath: string, relativePath: string): ExtractedFile {
  const source = fs.readFileSync(filePath, "utf-8");
  const tree = parser.parse(source);
  const root = tree.rootNode;

  const classes: ExtractedClass[] = [];
  const functions: ExtractedFunction[] = [];
  const imports: ExtractedImport[] = [];
  const exports: string[] = [];

  const structMap = new Map<string, ExtractedClass>();
  const deferredMethods: { receiverType: string; method: ExtractedFunction }[] = [];

  for (let i = 0; i < root.childCount; i++) {
    const node = root.child(i)!;

    if (node.type === "type_declaration") {
      for (let j = 0; j < node.childCount; j++) {
        const spec = node.child(j)!;
        if (spec.type === "type_spec") {
          const name = spec.childForFieldName("name")?.text;
          const typeNode = spec.childForFieldName("type");
          if (!name) continue;

          if (typeNode?.type === "struct_type") {
            const cls = extractStruct(name, typeNode);
            structMap.set(name, cls);
            classes.push(cls);
            if (isExported(name)) exports.push(name);
          } else if (typeNode?.type === "interface_type") {
            const cls = extractInterface(name, typeNode);
            classes.push(cls);
            if (isExported(name)) exports.push(name);
          }
        }
      }
    } else if (node.type === "function_declaration") {
      const fn = extractFunction(node);
      if (fn) {
        functions.push(fn);
        if (isExported(fn.name)) exports.push(fn.name);
      }
    } else if (node.type === "method_declaration") {
      const { receiverType, method } = extractMethod(node);
      if (method && receiverType) {
        const cls = structMap.get(receiverType);
        if (cls) {
          cls.methods.push(method);
        } else {
          deferredMethods.push({ receiverType, method });
        }
      }
    } else if (node.type === "import_declaration") {
      extractImports(node, imports);
    }
  }

  for (const { receiverType, method } of deferredMethods) {
    let cls = structMap.get(receiverType);
    if (!cls) {
      cls = { name: receiverType, methods: [], properties: [] };
      structMap.set(receiverType, cls);
      classes.push(cls);
      if (isExported(receiverType)) exports.push(receiverType);
    }
    cls.methods.push(method);
  }

  return { filePath: relativePath, language: "go", classes, functions, imports, exports };
}

function extractStruct(name: string, typeNode: Parser.SyntaxNode): ExtractedClass {
  const properties: string[] = [];
  const fieldList = findChild(typeNode, ["field_declaration_list"]);
  if (fieldList) {
    for (let i = 0; i < fieldList.childCount; i++) {
      const field = fieldList.child(i)!;
      if (field.type === "field_declaration") {
        const fieldName = field.childForFieldName("name")?.text;
        if (fieldName) properties.push(fieldName);
      }
    }
  }
  return { name, methods: [], properties };
}

function extractInterface(name: string, typeNode: Parser.SyntaxNode): ExtractedClass {
  const methods: ExtractedFunction[] = [];
  for (let i = 0; i < typeNode.childCount; i++) {
    const spec = typeNode.child(i)!;
    if (spec.type === "method_spec" || spec.type === "method_elem") {
      const methodName = spec.childForFieldName("name")?.text
        ?? findChild(spec, ["field_identifier"])?.text;
      if (methodName) {
        const params = extractParams(spec);
        methods.push({ name: methodName, params });
      }
    }
  }
  return { name, methods, properties: [], implements: ["interface"] };
}

function extractFunction(node: Parser.SyntaxNode): ExtractedFunction | null {
  const name = node.childForFieldName("name")?.text;
  if (!name) return null;
  const params = extractParams(node);
  const returnType = extractReturnType(node);
  return { name, params, returnType };
}

function extractMethod(node: Parser.SyntaxNode): { receiverType: string | null; method: ExtractedFunction | null } {
  const name = node.childForFieldName("name")?.text;
  if (!name) return { receiverType: null, method: null };

  // Extract receiver type: func (r *ReceiverType) MethodName(...)
  const receiver = node.childForFieldName("receiver");
  let receiverType: string | null = null;
  if (receiver) {
    const paramDecl = findChild(receiver, ["parameter_declaration"]);
    if (paramDecl) {
      const typeNode = paramDecl.childForFieldName("type");
      if (typeNode) {
        receiverType = typeNode.text.replace(/^\*/, ""); // strip pointer
      }
    }
  }

  const params = extractParams(node);
  const returnType = extractReturnType(node);
  return { receiverType, method: { name, params, returnType } };
}

function extractParams(node: Parser.SyntaxNode): string[] {
  const paramList = node.childForFieldName("parameters") ?? findChild(node, ["parameter_list"]);
  if (!paramList) return [];

  const params: string[] = [];
  for (let i = 0; i < paramList.childCount; i++) {
    const param = paramList.child(i)!;
    if (param.type === "parameter_declaration") {
      const name = param.childForFieldName("name")?.text;
      if (name) params.push(name);
    }
  }
  return params;
}

function extractReturnType(node: Parser.SyntaxNode): string | undefined {
  const result = node.childForFieldName("result");
  if (result) return result.text;
  return undefined;
}

function extractImports(node: Parser.SyntaxNode, imports: ExtractedImport[]) {
  // Single import or import block
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)!;
    if (child.type === "import_spec") {
      const path = child.childForFieldName("path")?.text?.replace(/"/g, "");
      if (path) {
        const name = path.split("/").pop() ?? path;
        imports.push({ source: path, names: [name] });
      }
    } else if (child.type === "import_spec_list") {
      for (let j = 0; j < child.childCount; j++) {
        const spec = child.child(j)!;
        if (spec.type === "import_spec") {
          const path = spec.childForFieldName("path")?.text?.replace(/"/g, "");
          if (path) {
            const name = path.split("/").pop() ?? path;
            imports.push({ source: path, names: [name] });
          }
        }
      }
    }
  }
}

function isExported(name: string): boolean {
  return name.length > 0 && name[0] === name[0].toUpperCase() && name[0] !== name[0].toLowerCase();
}

function findChild(node: Parser.SyntaxNode, types: string[]): Parser.SyntaxNode | null {
  for (let i = 0; i < node.childCount; i++) {
    if (types.includes(node.child(i)!.type)) return node.child(i)!;
  }
  return null;
}
