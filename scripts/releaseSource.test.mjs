import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'vitest';
import assert from 'node:assert/strict';
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
test('release validation rejects tags from another version and shell fragments', () => {
  for (const tag of ['v0.0.0', 'v1.0.54;echo unexpected', '../../main']) {
    const result = spawnSync(process.execPath, ['scripts/check-release-source.mjs'], { env: { ...process.env, REQUESTED_TAG: tag } });
    assert.notEqual(result.status, 0);
  }
  const valid = spawnSync(process.execPath, ['scripts/check-release-source.mjs'], { env: { ...process.env, REQUESTED_TAG: `v${version}` } });
  assert.equal(valid.status, 0);
});
test('release validation is mandatory and builds pin the validated commit', () => {
  const yaml = readFileSync('.github/workflows/release.yml', 'utf8');
  assert.match(yaml, /npm run build:verify/);
  assert.doesNotMatch(yaml, /github\.event\.pull_request\.head\.sha/);
  assert.match(yaml, /inputs\.tag\) \|\| github\.sha/);
  assert.match(yaml, /ref: \$\{\{ needs.validate.outputs.commit \}\}/);
  assert.doesNotMatch(yaml, /- name: UI smoke\s+if:/);
  assert.match(yaml, /npm run test:ui/);
  assert.match(yaml, /npm run test:ui:quality/);
  assert.match(yaml, /node scripts\/check-interaction-budget\.mjs/);
  assert.match(yaml, /needs: \[validate, build, build-android\]/);
  const android = readFileSync('.github/workflows/android.yml', 'utf8');
  assert.match(android, /ref: \$\{\{ github\.sha \}\}/);
  assert.doesNotMatch(android, /github\.event\.pull_request\.head\.sha/);
});
