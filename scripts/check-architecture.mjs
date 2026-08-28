#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

const budgets = [
  ['src/App.tsx', 90_000],
  ['src-tauri/src/db.rs', 280_000],
  ['src/components/composer/composer.css', 90_000],
];

const requiredFiles = [
  'src/app/AppRoot.tsx',
  'src/app/types.ts',
  'src-tauri/src/commands.rs',
  'src-tauri/src/db/migrations.rs',
];

let failed = false;

for (const relativePath of requiredFiles) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    console.error(`🚫 缺少架构边界文件: ${relativePath}`);
    failed = true;
  }
}

for (const [relativePath, maxBytes] of budgets) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) continue;
  // Git stores source with LF, while Windows checkouts commonly use CRLF.
  // Measure normalized source bytes so the same commit has the same budget on every OS.
  const size = Buffer.byteLength(fs.readFileSync(absolutePath, 'utf8').replace(/\r\n/g, '\n'));
  if (size > maxBytes) {
    console.error(`🚫 ${relativePath} 已增长到 ${size} B，超过架构预算 ${maxBytes} B`);
    failed = true;
  }
}

const mainPath = path.join(root, 'src', 'main.tsx');
if (fs.existsSync(mainPath)) {
  const mainSource = fs.readFileSync(mainPath, 'utf8');
  if (!mainSource.includes("from './app/AppRoot'")) {
    console.error('🚫 src/main.tsx 必须通过 app/AppRoot 进入应用，禁止重新直连 App.tsx');
    failed = true;
  }
  if (/from\s+['"]\.\/App['"]/.test(mainSource)) {
    console.error('🚫 src/main.tsx 不得直接导入 App.tsx');
    failed = true;
  }
}

if (failed) process.exit(1);

console.log('✅ 架构边界检查通过');
for (const [relativePath, maxBytes] of budgets) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) continue;
  const size = Buffer.byteLength(fs.readFileSync(absolutePath, 'utf8').replace(/\r\n/g, '\n'));
  console.log(`  ${relativePath}: ${size}/${maxBytes} B`);
}
