#!/usr/bin/env node
/* Extract rule blocks from an archived pass file if ANY top-level selector
 * (commas outside :is()/:not()/:has()) does NOT appear in any retained file.
 * Outputs the original block unchanged.
 *
 * Usage: node extract-missing-blocks.mjs <pass-file> <retained-dirs...>
 */
import { readFileSync } from 'node:fs';

const [, , passPath, ...retainedDirs] = process.argv;
const src = readFileSync(passPath, 'utf8');

let retained = '';
for (const d of retainedDirs) {
  const { readdirSync, statSync } = await import('node:fs');
  for (const f of readdirSync(d)) {
    if (!f.endsWith('.css')) continue;
    const p = `${d}/${f}`;
    if (statSync(p).isFile()) retained += readFileSync(p, 'utf8') + '\n';
  }
}

function topLevelSelectors(prelude) {
  const sels = [];
  let depth = 0;
  let cur = '';
  for (const ch of prelude) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { sels.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) sels.push(cur.trim());
  return sels;
}

let i = 0;
let pendingComment = null;
let prevEnd = 0;
const len = src.length;

function readComment() {
  if (src[i] === '/' && src[i + 1] === '*') {
    const end = src.indexOf('*/', i + 2);
    const c = src.slice(i, end + 2);
    i = end + 2;
    return c;
  }
  return null;
}

const out = [];
while (i < len) {
  const c = readComment();
  if (c) { pendingComment = c.trim(); continue; }
  if (src[i] !== '{') { i++; continue; }
  let depth = 0;
  let j = i;
  for (; j < len; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) break; }
  }
  if (j >= len) break;
  const block = src.slice(i, j + 1);
  let preludeText = src.slice(prevEnd, i).replace(/\/\*[\s\S]*?\*\//g, '').trim();
  prevEnd = j + 1;
  i = j + 1;
  if (!preludeText) continue;
  if (preludeText.startsWith('@')) {
    if (preludeText.includes('{')) continue; // handled as a rule below
    out.push({ text: (pendingComment ? '/* ' + pendingComment + ' */\n' : '') + preludeText + block, keep: true });
    pendingComment = null;
    continue;
  }
  const sels = topLevelSelectors(preludeText);
  const missing = sels.filter(s => !retained.includes(s));
  if (missing.length) {
    out.push({ text: (pendingComment ? '/* ' + pendingComment + ' */\n' : '') + preludeText + block, keep: true, missing });
  }
  pendingComment = null;
}

for (const o of out) console.log(o.text + (o.missing ? '\n/* MISSING: ' + o.missing.join(' | ') + ' */\n' : ''));