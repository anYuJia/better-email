import { build } from 'esbuild';
import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const compiled = await build({ stdin: { contents: "export { anchoredScrollTop } from './src/components/messageListAnchor'; export { calculateVisibleRange } from './src/components/messageListLayout';", resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm', platform: 'node' });
const { anchoredScrollTop, calculateVisibleRange } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const measure = (fn, iterations) => {
  for (let i = 0; i < 20; i += 1) fn();
  const samples = Array.from({ length: iterations }, () => { const start = performance.now(); fn(); return performance.now() - start; }).sort((a, b) => a - b);
  return { p50_ms: samples[Math.floor(samples.length * 0.5)], p95_ms: samples[Math.floor(samples.length * 0.95)] };
};
const results = [1000, 10000, 50000].map((count) => {
  const rows = Array.from({ length: count }, (_, index) => ({ key: `message-${index}` }));
  const layout = rows.map((_, index) => ({ top: index * 80, height: 80 }));
  const nextRows = [{ key: 'new-message' }, ...rows];
  const nextLayout = nextRows.map((_, index) => ({ top: index * 80, height: 80 }));
  const scroll = Math.floor(count / 2) * 80 + 12;
  assert.equal(anchoredScrollTop(rows, layout, nextRows, nextLayout, scroll), scroll + 80);
  return { messages: count, visible_range: measure(() => calculateVisibleRange(layout, scroll, 844), 500), prepend_anchor: measure(() => anchoredScrollTop(rows, layout, nextRows, nextLayout, scroll), 100) };
});
const report = { node: process.version, platform: process.platform, arch: process.arch, kind: 'pure-list-algorithm; not browser/native startup, FPS, or database throughput', results };
const output = JSON.stringify(report, null, 2);
console.log(output);
if (process.argv[2]) writeFileSync(process.argv[2], `${output}\n`);
