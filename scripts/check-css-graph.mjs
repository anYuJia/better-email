#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const rootStyleDir = path.join(root, 'src', 'styles');
const entry = path.join(root, 'src', 'ui-2026.css');

const importRe = /@import\s+['"](.+?)['"]/g;

function walkCssFiles(dir) {
  const files = [];
  for (const entryName of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entryName.name);
    if (entryName.isDirectory()) {
      files.push(...walkCssFiles(p));
    } else if (entryName.isFile() && p.endsWith('.css')) {
      files.push(p);
    }
  }
  return files;
}

function buildImportList(start) {
  const importList = [];
  const queue = [start];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!fs.existsSync(current)) continue;

    const text = fs.readFileSync(current, 'utf8');
    let match;
    while ((match = importRe.exec(text)) !== null) {
      const importSpec = match[1];
      if (!importSpec.startsWith('./')) continue;
      const absolute = path.resolve(path.dirname(current), importSpec);
      importList.push(absolute);
      queue.push(absolute);
    }
  }

  return importList;
}

function collectReachable(start) {
  const queue = [start];
  const reachable = new Set();

  while (queue.length > 0) {
    const current = queue.shift();
    if (reachable.has(current)) continue;
    if (!fs.existsSync(current)) continue;
    reachable.add(current);

    const text = fs.readFileSync(current, 'utf8');
    let match;
    while ((match = importRe.exec(text)) !== null) {
      const importSpec = match[1];
      if (!importSpec.startsWith('./')) continue;
      const absolute = path.resolve(path.dirname(current), importSpec);
      if (!reachable.has(absolute)) queue.push(absolute);
    }
  }

  return reachable;
}

const importOrder = buildImportList(entry);
const duplicateImports = importOrder.reduce((acc, cssPath) => {
  const next = acc.counts.get(cssPath) || 0;
  acc.counts.set(cssPath, next + 1);
  if (next + 1 === 2) {
    acc.duplicates.push(cssPath);
  }
  return acc;
}, { counts: new Map(), duplicates: [] });

if (duplicateImports.duplicates.length > 0) {
  console.error('🚫 检测到重复的 CSS 入口导入：');
  for (const duplicate of duplicateImports.duplicates) {
    console.error(`  - ${path.relative(root, duplicate)}`);
  }
  console.error(`检查失败：发现 ${duplicateImports.duplicates.length} 个重复导入`);
  process.exit(1);
}

const reachable = collectReachable(entry);
const all = walkCssFiles(rootStyleDir);
const toRelative = (absPath) => path.relative(root, absPath);

const unreachable = all.filter((file) => !reachable.has(file));

if (unreachable.length > 0) {
  console.error('🚫 未被入口样式图覆盖的文件:');
  for (const file of unreachable.sort()) {
    console.error(`  - ${toRelative(file)}`);
  }
  console.error(`检查失败：检测到 ${unreachable.length} 个未触达文件`);
  process.exit(1);
}

console.log('✅ CSS 入口图检查通过，覆盖率为 100%');
console.log(`总文件: ${all.length}`);
console.log(`入口触达: ${reachable.size}`);
