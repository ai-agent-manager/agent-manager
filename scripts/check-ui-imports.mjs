import { isBuiltin } from 'node:module';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parse } from '@babel/parser';

// TypeScript 7 no longer ships the in-process compiler API (createSourceFile
// and friends), so the import-boundary checks parse with @babel/parser instead.
const root = fileURLToPath(new URL('../web-ui/src/', import.meta.url));

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => entry.isDirectory() ? files(path.join(directory, entry.name)) : [path.join(directory, entry.name)]));
  return nested.flat().filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file));
}

function parseFile(file, source) {
  const plugins = file.endsWith('.tsx') ? ['typescript', 'jsx'] : ['typescript'];
  return parse(source, { sourceType: 'module', plugins, sourceFilename: file, errorRecovery: false });
}

// Minimal AST walk: every child object with a string `type` is a node.
function walk(node, visit) {
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'range' || key === 'extra' || key === 'comments' || key === 'leadingComments' || key === 'trailingComments') continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) if (child && typeof child.type === 'string') walk(child, visit);
    } else if (value && typeof value.type === 'string') {
      walk(value, visit);
    }
  }
}

const isStringLiteral = (node) => Boolean(node) && node.type === 'StringLiteral';

for (const file of await files(root)) {
  const ast = parseFile(file, await readFile(file, 'utf8'));
  function check(specifier, typeOnly) {
    if (specifier === '@api-types' && typeOnly) return;
    if (specifier === '@api-types' || isBuiltin(specifier) || specifier.startsWith('node:') || specifier.startsWith('/')) throw new Error(`Forbidden browser runtime import in ${path.relative(root, file)}: ${specifier}`);
    if (specifier.startsWith('.')) {
      const relative = path.relative(root, path.resolve(path.dirname(file), specifier));
      if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Browser import escapes web-ui/src: ${specifier}`);
    }
  }
  walk(ast.program, (node) => {
    if (node.type === 'ImportDeclaration' && isStringLiteral(node.source)) check(node.source.value, node.importKind === 'type');
    if ((node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') && isStringLiteral(node.source)) check(node.source.value, node.exportKind === 'type');
    if (node.type === 'ImportExpression' || (node.type === 'CallExpression' && node.callee.type === 'Import')) {
      const argument = node.type === 'ImportExpression' ? node.source : node.arguments[0];
      if (!isStringLiteral(argument)) throw new Error('Browser dynamic imports must be literal paths.');
      check(argument.value, false);
    }
  });
}

const dtoPath = fileURLToPath(new URL('../src/ui-server/api-types.ts', import.meta.url));
const dto = parseFile(dtoPath, await readFile(dtoPath, 'utf8'));
const typeOnlyDeclarations = new Set(['TSInterfaceDeclaration', 'TSTypeAliasDeclaration']);
for (const node of dto.program.body) {
  if (node.type === 'ImportDeclaration') {
    if (node.importKind !== 'type' || !isStringLiteral(node.source)
      || !['../config/scopes.js', '../discovery/types.js'].includes(node.source.value)) throw new Error('API DTO imports must be type-only and come from approved pure modules.');
    continue;
  }
  // `export interface X {}` wraps the declaration in ExportNamedDeclaration.
  const declaration = node.type === 'ExportNamedDeclaration' && node.declaration ? node.declaration : node;
  if (!typeOnlyDeclarations.has(declaration.type) && node.type !== 'EmptyStatement') throw new Error('API DTO module must contain types only.');
}
