import Parser from "tree-sitter";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { typescript, tsx } = require("tree-sitter-typescript");
import fs from "fs";
import type { ExtractedFile, ExtractedClass, ExtractedFunction, ExtractedImport } from "./types";

const tsParser = new Parser();
const tsxParser = new Parser();
tsParser.setLanguage(typescript as Parser.Language);
tsxParser.setLanguage(tsx as Parser.Language);

export function extractTypeScript(filePath: string, relativePath: string): ExtractedFile {
  const source = fs.readFileSync(filePath, "utf-8");
  const isTsx = filePath.endsWith(".tsx") || filePath.endsWith(".jsx");
  const parser = isTsx ? tsxParser : tsParser;
  const tree = parser.parse(source);
  const root = tree.rootNode;

  const classes: ExtractedClass[] = [];
  const functions: ExtractedFunction[] = [];
  const imports: ExtractedImport[] = [];
  const exports: string[] = [];

  for (let i = 0; i < root.childCount; i++) {
    const node = root.child(i)!;

    // Handle export statements that wrap declarations
    if (node.type === "export_statement") {
      const decl = node.childForFieldName("declaration") ?? findChildByTypes(node, [
        "class_declaration", "function_declaration", "lexical_declaration",
        "variable_declaration", "interface_declaration", "type_alias_declaration",
      ]);

      if (decl) {
        if (decl.type === "class_declaration") {
          const cls = extractClass(decl);
          if (cls) {
            classes.push(cls);
            exports.push(cls.name);
          }
        } else if (decl.type === "function_declaration") {
          const fn = extractFunction(decl);
          if (fn) {
            functions.push(fn);
            exports.push(fn.name);
          }
        } else if (decl.type === "lexical_declaration" || decl.type === "variable_declaration") {
          extractVarDeclarations(decl, functions, exports, true);
        } else if (decl.type === "interface_declaration" || decl.type === "type_alias_declaration") {
          const name = decl.childForFieldName("name")?.text;
          if (name) exports.push(name);
        }
      }
      continue;
    }

    // Top-level declarations (not exported)
    if (node.type === "class_declaration") {
      const cls = extractClass(node);
      if (cls) classes.push(cls);
    } else if (node.type === "function_declaration") {
      const fn = extractFunction(node);
      if (fn) functions.push(fn);
    } else if (node.type === "import_statement") {
      const imp = extractImport(node);
      if (imp) imports.push(imp);
    } else if (node.type === "lexical_declaration" || node.type === "variable_declaration") {
      extractVarDeclarations(node, functions, exports, false);
    }
  }

  return {
    filePath: relativePath,
    language: isTsx ? "tsx" : "typescript",
    classes,
    functions,
    imports,
    exports,
  };
}

function extractClass(node: Parser.SyntaxNode): ExtractedClass | null {
  const name = node.childForFieldName("name")?.text;
  if (!name) return null;

  const body = node.childForFieldName("body");
  const methods: ExtractedFunction[] = [];
  const properties: string[] = [];
  let extendsName: string | undefined;
  const implementsList: string[] = [];

  // Heritage clause (extends / implements)
  const heritage = findChildByTypes(node, ["class_heritage"]);
  if (heritage) {
    for (let i = 0; i < heritage.childCount; i++) {
      const clause = heritage.child(i)!;
      if (clause.type === "extends_clause") {
        extendsName = clause.child(1)?.text;
      } else if (clause.type === "implements_clause") {
        for (let j = 1; j < clause.childCount; j++) {
          const impl = clause.child(j);
          if (impl && impl.type !== ",") implementsList.push(impl.text);
        }
      }
    }
  }

  if (body) {
    for (let i = 0; i < body.childCount; i++) {
      const member = body.child(i)!;
      if (member.type === "method_definition") {
        const fn = extractMethod(member);
        if (fn) methods.push(fn);
      } else if (member.type === "public_field_definition" || member.type === "property_declaration") {
        const propName = member.childForFieldName("name")?.text;
        if (propName) properties.push(propName);
      }
    }
  }

  return {
    name,
    methods,
    properties,
    extends: extendsName,
    implements: implementsList.length > 0 ? implementsList : undefined,
  };
}

function extractFunction(node: Parser.SyntaxNode): ExtractedFunction | null {
  const name = node.childForFieldName("name")?.text;
  if (!name) return null;

  const params = extractParams(node);
  const returnType = extractReturnType(node);
  const isAsync = node.text.startsWith("async ");

  return { name, params, returnType, isAsync };
}

function extractMethod(node: Parser.SyntaxNode): ExtractedFunction | null {
  const name = node.childForFieldName("name")?.text;
  if (!name || name === "constructor") return null;

  const params = extractParams(node);
  const returnType = extractReturnType(node);
  const isAsync = node.text.startsWith("async ");

  return { name, params, returnType, isAsync };
}

function extractParams(node: Parser.SyntaxNode): string[] {
  const paramsNode = node.childForFieldName("parameters") ??
    findChildByTypes(node, ["formal_parameters"]);
  if (!paramsNode) return [];

  const params: string[] = [];
  for (let i = 0; i < paramsNode.childCount; i++) {
    const param = paramsNode.child(i)!;
    if (param.type === "required_parameter" || param.type === "optional_parameter") {
      const pName = param.childForFieldName("pattern")?.text ?? param.child(0)?.text;
      if (pName && pName !== "(" && pName !== ")" && pName !== ",") {
        params.push(pName);
      }
    } else if (param.type === "identifier") {
      params.push(param.text);
    }
  }
  return params;
}

function extractReturnType(node: Parser.SyntaxNode): string | undefined {
  const typeAnnotation = node.childForFieldName("return_type");
  if (typeAnnotation) {
    // Skip the ": " prefix
    const typeNode = typeAnnotation.child(1) ?? typeAnnotation.child(0);
    return typeNode?.text;
  }
  return undefined;
}

function extractImport(node: Parser.SyntaxNode): ExtractedImport | null {
  const sourceNode = node.childForFieldName("source") ??
    findChildByTypes(node, ["string"]);
  if (!sourceNode) return null;

  const source = sourceNode.text.replace(/^['"]|['"]$/g, "");
  const names: string[] = [];
  let isDefault = false;

  const importClause = findChildByTypes(node, ["import_clause"]);
  if (importClause) {
    for (let i = 0; i < importClause.childCount; i++) {
      const child = importClause.child(i)!;
      if (child.type === "identifier") {
        names.push(child.text);
        isDefault = true;
      } else if (child.type === "named_imports") {
        for (let j = 0; j < child.childCount; j++) {
          const spec = child.child(j)!;
          if (spec.type === "import_specifier") {
            const imported = spec.childForFieldName("name")?.text ?? spec.child(0)?.text;
            if (imported) names.push(imported);
          }
        }
      }
    }
  }

  return { source, names, isDefault: isDefault || undefined };
}

function extractVarDeclarations(
  node: Parser.SyntaxNode,
  functions: ExtractedFunction[],
  exports: string[],
  isExported: boolean,
) {
  for (let i = 0; i < node.childCount; i++) {
    const decl = node.child(i)!;
    if (decl.type !== "variable_declarator") continue;

    const name = decl.childForFieldName("name")?.text;
    if (!name) continue;

    const value = decl.childForFieldName("value");
    if (value && (value.type === "arrow_function" || value.type === "function_expression" || value.type === "function")) {
      const params = extractParams(value);
      const returnType = extractReturnType(value);
      functions.push({ name, params, returnType });
    }

    if (isExported) exports.push(name);
  }
}

function findChildByTypes(node: Parser.SyntaxNode, types: string[]): Parser.SyntaxNode | null {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)!;
    if (types.includes(child.type)) return child;
  }
  return null;
}
