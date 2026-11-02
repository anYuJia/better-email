import { build } from 'esbuild';
import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const compiled = await build({
  stdin: { contents: "export { buildMessageSearchSuggestions } from './src/components/messageListSearchSuggestions';", resolveDir: process.cwd() },
  bundle: true, write: false, format: 'esm', platform: 'node',
});
const { buildMessageSearchSuggestions } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);

// Preserve the previous seven-pass counting algorithm as a comparison. This
// excludes its output-object construction, making the old baseline conservative.
function legacyCounts(entries, text) {
  const matches = (entry) => !text || entry.to.includes(text) || entry.from.includes(text) || entry.body.includes(text);
  const count = (predicate) => entries.reduce((sum, entry) => sum + (predicate(entry) ? 1 : 0), 0);
  return [
    count(matches), count((entry) => entry.from.includes(text)),
    count((entry) => entry.to.includes(text)), count((entry) => entry.body.includes(text)),
    count((entry) => entry.hasAttachments && matches(entry)),
    count((entry) => !entry.isRead && matches(entry)), count((entry) => entry.isStarred && matches(entry)),
  ];
}

function measurePair(before, after) {
  for (let i = 0; i < 10; i += 1) { before(); after(); }
  const samples = { before: [], after: [] };
  const sample = (name, run) => {
    const start = performance.now();
    run();
    samples[name].push(performance.now() - start);
  };
  for (let i = 0; i < 30; i += 1) {
    if (i % 2) { sample('after', after); sample('before', before); }
    else { sample('before', before); sample('after', after); }
  }
  return Object.fromEntries(Object.entries(samples).map(([name, values]) => {
    values.sort((a, b) => a - b);
    return [name, { p50_ms: values[15], p95_ms: values[28] }];
  }));
}

const results = [];
for (const size of [1000, 10000, 50000]) {
  const entries = Array.from({ length: size }, (_, index) => ({
    to: `me${index}@example.com`,
    from: `${index % 7 === 0 ? '合同' : '邮件'}联系人 ${index}@example.com`,
    body: `${index % 13 === 0 ? '合同' : '每周进展'} 项目事项 ${index} ${'这是一段真实长度的摘要内容'.repeat(5)}`,
    hasAttachments: index % 3 === 0, isRead: index % 4 !== 0, isStarred: index % 8 === 0,
  }));
  for (const query of ['合同', 'example', '未匹配内容']) {
    const before = () => legacyCounts(entries, query);
    const after = () => buildMessageSearchSuggestions(entries, query).map((item) => item.count);
    assert.deepEqual(after(), before());
    results.push({ summaries: size, query, counts: after(), ...measurePair(before, after) });
  }
}
const report = {
  node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model,
  warmup_pairs: 10, samples_per_case: 30,
  scope: 'Warm synthetic summary counting only; excludes data preparation, React, DOM, IPC, full-body search. Not input latency or FPS.',
  results,
};
const output = JSON.stringify(report, null, 2);
console.log(output);
if (process.argv[2]) writeFileSync(process.argv[2], `${output}\n`);
