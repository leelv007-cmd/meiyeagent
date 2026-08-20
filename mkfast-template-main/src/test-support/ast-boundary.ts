/**
 * AST-boundary helpers for production-wiring tests.
 * Inspect compiler nodes instead of regex-matching production TypeScript.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export type ParsedSource = {
  path: string;
  sourceFile: ts.SourceFile;
};

export function parseProductionSource(filePath: string | URL): ParsedSource {
  const path = filePath instanceof URL ? fileURLToPath(filePath) : filePath;
  return parseSourceText(path, readFileSync(path, 'utf8'));
}

export function parseSourceText(fileName: string, text: string): ParsedSource {
  return {
    path: fileName,
    sourceFile: ts.createSourceFile(
      fileName,
      text,
      ts.ScriptTarget.Latest,
      true,
      fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    ),
  };
}

function walk(node: ts.Node, visit: (current: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

function entityName(node: ts.Node): string {
  return node.getText();
}

export function valueImports(
  parsed: ParsedSource
): Array<{ name: string; module: string }> {
  const result: Array<{ name: string; module: string }> = [];
  for (const statement of parsed.sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (statement.importClause?.isTypeOnly) continue;
    const module = ts.isStringLiteral(statement.moduleSpecifier)
      ? statement.moduleSpecifier.text
      : statement.moduleSpecifier.getText();
    const clause = statement.importClause;
    if (!clause) continue;
    if (clause.name) {
      result.push({ name: clause.name.text, module });
    }
    const bindings = clause.namedBindings;
    if (!bindings) continue;
    if (ts.isNamespaceImport(bindings)) {
      result.push({ name: bindings.name.text, module });
      continue;
    }
    for (const element of bindings.elements) {
      if (element.isTypeOnly) continue;
      result.push({ name: element.name.text, module });
    }
  }
  return result;
}

export function hasValueImport(
  parsed: ParsedSource,
  name: string,
  moduleNeedle?: string
): boolean {
  return valueImports(parsed).some(
    (entry) =>
      entry.name === name &&
      (moduleNeedle === undefined || entry.module.includes(moduleNeedle))
  );
}

export function constructors(parsed: ParsedSource): string[] {
  const names: string[] = [];
  walk(parsed.sourceFile, (node) => {
    if (ts.isNewExpression(node)) {
      names.push(entityName(node.expression));
    }
  });
  return names;
}

export function calls(parsed: ParsedSource): string[] {
  const names: string[] = [];
  walk(parsed.sourceFile, (node) => {
    if (ts.isCallExpression(node)) {
      names.push(entityName(node.expression));
    }
  });
  return names;
}

export function hasCall(parsed: ParsedSource, name: string): boolean {
  return calls(parsed).some(
    (callee) => callee === name || callee.endsWith(`.${name}`)
  );
}

export type JsxElementInfo = {
  tag: string;
  attrs: Record<string, string>;
};

function jsxAttributes(node: ts.JsxOpeningLikeElement): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const property of node.attributes.properties) {
    if (!ts.isJsxAttribute(property)) continue;
    const name = property.name.getText();
    if (!property.initializer) {
      attrs[name] = 'true';
      continue;
    }
    if (ts.isStringLiteralLike(property.initializer)) {
      attrs[name] = property.initializer.text;
      continue;
    }
    if (
      ts.isJsxExpression(property.initializer) &&
      property.initializer.expression
    ) {
      attrs[name] = property.initializer.expression.getText();
      continue;
    }
    attrs[name] = property.initializer.getText();
  }
  return attrs;
}

export function jsxElements(parsed: ParsedSource): JsxElementInfo[] {
  const elements: JsxElementInfo[] = [];
  walk(parsed.sourceFile, (node) => {
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      elements.push({
        tag: node.tagName.getText(),
        attrs: jsxAttributes(node),
      });
    }
  });
  return elements;
}

export function jsxOf(parsed: ParsedSource, tag: string): JsxElementInfo[] {
  return jsxElements(parsed).filter((element) => element.tag === tag);
}

export function literals(parsed: ParsedSource): string[] {
  const values: string[] = [];
  walk(parsed.sourceFile, (node) => {
    if (ts.isStringLiteralLike(node)) {
      values.push(node.text);
      return;
    }
    if (ts.isJsxText(node)) {
      const text = node.getText().trim();
      if (text) values.push(text);
      return;
    }
    if (
      ts.isTemplateExpression(node) ||
      ts.isNoSubstitutionTemplateLiteral(node)
    ) {
      values.push(node.getText().slice(1, -1));
    }
  });
  return values;
}

export function identifiers(parsed: ParsedSource): Set<string> {
  const names = new Set<string>();
  walk(parsed.sourceFile, (node) => {
    if (ts.isIdentifier(node)) names.add(node.text);
  });
  return names;
}

export function propertyAccesses(parsed: ParsedSource): string[] {
  const names: string[] = [];
  walk(parsed.sourceFile, (node) => {
    if (ts.isPropertyAccessExpression(node)) {
      names.push(node.getText());
    }
  });
  return names;
}

export function typeMembers(parsed: ParsedSource, typeName: string): string[] {
  const members: string[] = [];
  const collect = (type: ts.TypeNode | ts.TypeElement[] | undefined) => {
    const elements = Array.isArray(type)
      ? type
      : type && ts.isTypeLiteralNode(type)
        ? type.members
        : undefined;
    if (!elements) return;
    for (const member of elements) {
      if (
        (ts.isPropertySignature(member) || ts.isMethodSignature(member)) &&
        member.name &&
        ts.isIdentifier(member.name)
      ) {
        members.push(member.name.text);
      }
    }
  };
  for (const statement of parsed.sourceFile.statements) {
    if (
      ts.isTypeAliasDeclaration(statement) &&
      statement.name.text === typeName
    ) {
      collect(statement.type);
    }
    if (
      ts.isInterfaceDeclaration(statement) &&
      statement.name.text === typeName
    ) {
      collect(Array.from(statement.members));
    }
  }
  return members.sort();
}

export function propertyValues(parsed: ParsedSource, name: string): string[] {
  const values: string[] = [];
  walk(parsed.sourceFile, (node) => {
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name
    ) {
      values.push(node.initializer.getText());
    }
    if (ts.isShorthandPropertyAssignment(node) && node.name.text === name) {
      values.push(node.name.text);
    }
  });
  return values;
}

export function objectLiteralProps(
  parsed: ParsedSource,
  propertyName: string
): Record<string, string>[] {
  const objects: Record<string, string>[] = [];
  walk(parsed.sourceFile, (node) => {
    if (
      !ts.isPropertyAssignment(node) ||
      !ts.isIdentifier(node.name) ||
      node.name.text !== propertyName ||
      !ts.isObjectLiteralExpression(node.initializer)
    ) {
      return;
    }
    const props: Record<string, string> = {};
    for (const property of node.initializer.properties) {
      if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.name)) {
        props[property.name.text] = property.initializer.getText();
      }
      if (ts.isShorthandPropertyAssignment(property)) {
        props[property.name.text] = property.name.text;
      }
    }
    objects.push(props);
  });
  return objects;
}

export function arrayPropertyElements(
  parsed: ParsedSource,
  propertyName: string
): string[][] {
  const arrays: string[][] = [];
  walk(parsed.sourceFile, (node) => {
    if (
      !ts.isPropertyAssignment(node) ||
      !ts.isIdentifier(node.name) ||
      node.name.text !== propertyName ||
      !ts.isArrayLiteralExpression(node.initializer)
    ) {
      return;
    }
    arrays.push(node.initializer.elements.map((element) => element.getText()));
  });
  return arrays;
}

export function callArgumentObjects(
  parsed: ParsedSource,
  calleeName: string
): Record<string, string>[] {
  const objects: Record<string, string>[] = [];
  walk(parsed.sourceFile, (node) => {
    if (!ts.isCallExpression(node)) return;
    const callee = entityName(node.expression);
    if (callee !== calleeName && !callee.endsWith(`.${calleeName}`)) {
      return;
    }
    for (const argument of node.arguments) {
      if (!ts.isObjectLiteralExpression(argument)) continue;
      const props: Record<string, string> = {};
      for (const property of argument.properties) {
        if (
          ts.isPropertyAssignment(property) &&
          ts.isIdentifier(property.name)
        ) {
          props[property.name.text] = property.initializer.getText();
        }
        if (ts.isShorthandPropertyAssignment(property)) {
          props[property.name.text] = property.name.text;
        }
      }
      objects.push(props);
    }
  });
  return objects;
}

function namedFunctionLike(
  parsed: ParsedSource,
  name: string
): ts.Node | undefined {
  let match: ts.Node | undefined;
  walk(parsed.sourceFile, (node) => {
    if (match) return;
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      match = node;
      return;
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) ||
        ts.isFunctionExpression(node.initializer))
    ) {
      match = node.initializer;
    }
  });
  return match;
}

export function functionReturnKeys(
  parsed: ParsedSource,
  name: string
): string[] {
  const fn = namedFunctionLike(parsed, name);
  if (!fn) return [];
  const keys: string[] = [];
  walk(fn, (node) => {
    if (
      !ts.isReturnStatement(node) ||
      !node.expression ||
      !ts.isObjectLiteralExpression(node.expression)
    ) {
      return;
    }
    for (const property of node.expression.properties) {
      if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.name)) {
        keys.push(property.name.text);
      }
      if (ts.isShorthandPropertyAssignment(property)) {
        keys.push(property.name.text);
      }
    }
  });
  return keys;
}

export function functionCalls(parsed: ParsedSource, name: string): string[] {
  const fn = namedFunctionLike(parsed, name);
  if (!fn) return [];
  const names: string[] = [];
  walk(fn, (node) => {
    if (ts.isCallExpression(node)) names.push(entityName(node.expression));
  });
  return names;
}

export function functionAccesses(parsed: ParsedSource, name: string): string[] {
  const fn = namedFunctionLike(parsed, name);
  if (!fn) return [];
  const names: string[] = [];
  walk(fn, (node) => {
    if (ts.isPropertyAccessExpression(node)) names.push(node.getText());
  });
  return names;
}

export function functionNodeStart(parsed: ParsedSource, name: string): number {
  return namedFunctionLike(parsed, name)?.getStart() ?? -1;
}

export function firstIdentifierStart(
  parsed: ParsedSource,
  name: string,
  after = 0
): number {
  let start = -1;
  walk(parsed.sourceFile, (node) => {
    if (!ts.isIdentifier(node) || node.text !== name) return;
    const position = node.getStart();
    if (position < after) return;
    if (start === -1 || position < start) start = position;
  });
  return start;
}

export function firstCallStart(
  parsed: ParsedSource,
  name: string,
  after = 0
): number {
  let start = -1;
  walk(parsed.sourceFile, (node) => {
    if (!ts.isCallExpression(node)) return;
    const callee = entityName(node.expression);
    if (callee !== name && !callee.endsWith(`.${name}`)) return;
    const position = node.getStart();
    if (position < after) return;
    if (start === -1 || position < start) start = position;
  });
  return start;
}

export function variableInitializerAccesses(
  parsed: ParsedSource,
  name: string
): string[] {
  const names: string[] = [];
  walk(parsed.sourceFile, (node) => {
    if (
      !ts.isVariableDeclaration(node) ||
      !ts.isIdentifier(node.name) ||
      node.name.text !== name ||
      !node.initializer
    ) {
      return;
    }
    walk(node.initializer, (current) => {
      if (ts.isPropertyAccessExpression(current)) {
        names.push(current.getText());
      }
      if (ts.isIdentifier(current)) names.push(current.text);
    });
  });
  return names;
}

export function equalityTargets(
  parsed: ParsedSource
): Array<{ left: string; right: string }> {
  const pairs: Array<{ left: string; right: string }> = [];
  walk(parsed.sourceFile, (node) => {
    if (
      !ts.isBinaryExpression(node) ||
      (node.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken &&
        node.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsToken)
    ) {
      return;
    }
    pairs.push({
      left: node.left.getText(),
      right: ts.isStringLiteralLike(node.right)
        ? node.right.text
        : node.right.getText(),
    });
  });
  return pairs;
}

export function constructorArgs(
  parsed: ParsedSource,
  name: string
): string[][] {
  const args: string[][] = [];
  walk(parsed.sourceFile, (node) => {
    if (!ts.isNewExpression(node)) return;
    if (entityName(node.expression) !== name) return;
    args.push((node.arguments ?? []).map((argument) => argument.getText()));
  });
  return args;
}
