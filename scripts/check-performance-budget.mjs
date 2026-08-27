#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const distDir = path.join(root, 'dist');
const assetsDir = path.join(distDir, 'assets');

const limits = {
  totalJs: 1_800_000,
  largestJs: 900_000,
  totalCss: 600_000,
  largestCss: 350_000,
};

if (!fs.existsSync(assetsDir)) {
  console.error('🚫 未找到 dist/assets，请先执行 npm run build');
  process.exit(1);
}

function walk(dir) {
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...walk(absolute));
    else if (entry.isFile()) result.push(absolute);
  }
  return result;
}

const assets = walk(assetsDir).map((absolute) => ({
  path: path.relative(distDir, absolute).replaceAll('\\', '/'),
  extension: path.extname(absolute).toLowerCase(),
  bytes: fs.statSync(absolute).size,
}));

function summarize(extension) {
  const matching = assets.filter((asset) => asset.extension === extension);
  return {
    total: matching.reduce((sum, asset) => sum + asset.bytes, 0),
    largest: matching.reduce((max, asset) => Math.max(max, asset.bytes), 0),
    top: [...matching].sort((a, b) => b.bytes - a.bytes).slice(0, 5),
  };
}

const js = summarize('.js');
const css = summarize('.css');
const failures = [];

if (js.total > limits.totalJs) failures.push(`JS 总体积 ${js.total} > ${limits.totalJs}`);
if (js.largest > limits.largestJs) failures.push(`最大 JS ${js.largest} > ${limits.largestJs}`);
if (css.total > limits.totalCss) failures.push(`CSS 总体积 ${css.total} > ${limits.totalCss}`);
if (css.largest > limits.largestCss) failures.push(`最大 CSS ${css.largest} > ${limits.largestCss}`);

console.log(`JS: total=${js.total} B largest=${js.largest} B`);
console.log(`CSS: total=${css.total} B largest=${css.largest} B`);
for (const asset of [...js.top, ...css.top]) {
  console.log(`  ${asset.path}: ${asset.bytes} B`);
}

if (failures.length > 0) {
  console.error('🚫 性能预算检查失败');
  failures.forEach((failure) => console.error(`  - ${failure}`));
  process.exit(1);
}

console.log('✅ 前端构建性能预算检查通过');
