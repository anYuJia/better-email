import { readFileSync } from 'node:fs';

// A coarse guard against severe regressions, not a native input-latency SLO.
// CI runners vary considerably; tighten only after collecting comparable runs.
const reportPath = process.argv[2];
if (!reportPath) throw new Error('Usage: node scripts/check-interaction-budget.mjs <quality-report.json>');
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
const result = report.interactions;
if (report.kind !== 'mock-browser-quality-matrix' || report.status !== 'ok'
    || !result || result.samples < 24 || !Number.isFinite(result.cachedSwitchPaintP95Ms)
    || result.cachedSwitchPaintP95Ms < 0) {
  throw new Error('Missing or invalid cached message-switch measurements');
}
const limitMs = 500;
if (result.cachedSwitchPaintP95Ms > limitMs) {
  throw new Error(`Mock Chromium cached switch-to-two-rAF p95 ${result.cachedSwitchPaintP95Ms.toFixed(1)} ms exceeds ${limitMs} ms`);
}
console.log(`Mock Chromium cached switch-to-two-rAF p95: ${result.cachedSwitchPaintP95Ms.toFixed(1)} / ${limitMs} ms (${result.samples} samples)`);
