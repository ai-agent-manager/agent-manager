import { isBuiltin } from 'node:module';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';

const root = fileURLToPath(new URL('../web-ui/src/', import.meta.url));
async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => entry.isDirectory() ? files(path.join(directory, entry.name)) : [path.join(directory, entry.name)]));
  return nested.flat().filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file));
}
for (const file of await files(root)) {
  const ast = ts.createSourceFile(file, await readFile(file, 'utf8'), ts.ScriptTarget.Latest, true);
  function check(specifier, typeOnly) {
    if (specifier === '@api-types' && typeOnly) return;
    if (specifier === '@api-types' || isBuiltin(specifier) || specifier.startsWith('node:') || specifier.startsWith('/')) throw new Error(`Forbidden browser runtime import in ${path.relative(root, file)}: ${specifier}`);
    if (specifier.startsWith('.')) {
      const relative = path.relative(root, path.resolve(path.dirname(file), specifier));
      if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Browser import escapes web-ui/src: ${specifier}`);
    }
  }
  function visit(node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) check(node.moduleSpecifier.text, node.importClause?.isTypeOnly);
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) check(node.moduleSpecifier.text, node.isTypeOnly);
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      if (!node.arguments[0] || !ts.isStringLiteral(node.arguments[0])) throw new Error('Browser dynamic imports must be literal paths.');
      check(node.arguments[0].text, false);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
}
const dtoPath = fileURLToPath(new URL('../src/ui-server/api-types.ts', import.meta.url));
const dto = ts.createSourceFile(dtoPath, await readFile(dtoPath, 'utf8'), ts.ScriptTarget.Latest, true);
for (const node of dto.statements) {
  if (ts.isImportDeclaration(node)) {
    if (!node.importClause?.isTypeOnly || !ts.isStringLiteral(node.moduleSpecifier)
      || !['../config/scopes.js', '../discovery/types.js'].includes(node.moduleSpecifier.text)) throw new Error('API DTO imports must be type-only and come from approved pure modules.');
  } else if (!ts.isInterfaceDeclaration(node) && !ts.isTypeAliasDeclaration(node) && !ts.isEmptyStatement(node)) throw new Error('API DTO module must contain types only.');
}
