import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const tag = process.env.REQUESTED_TAG || '';
if (tag && (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag) || tag !== `v${version}`)) {
  throw new Error(`Release tag ${JSON.stringify(tag)} does not match source version v${version}`);
}
console.log(`Source version verified: v${version}${tag ? ` (${tag})` : ''}`);
