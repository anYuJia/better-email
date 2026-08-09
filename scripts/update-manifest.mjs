// scripts/update-manifest.mjs
//
// Generates the Tauri updater static JSON manifest (latest.json) after all
// release assets have been renamed to their canonical names, so every URL
// points at the exact file that will be attached to the GitHub Release.
//
// Tauri updater does NOT support DMG as the macOS update payload: on macOS
// the update bundle is the signed .app.tar.gz archive. The DMG is only the
// user-facing installer. On Windows the MSI doubles as installer and update
// payload. See https://tauri.app/plugin/updater/ for the manifest format.
//
// Usage:
//   node scripts/update-manifest.mjs \
//     --version 1.0.11 \
//     --tag v1.0.11 \
//     --repo anYuJia/better-email \
//     --payload darwin-aarch64=./Better_Email_1.0.11_mac_arm.app.tar.gz \
//     --payload windows-x86_64=./Better_Email_1.0.11_windows_x64.msi \
//     --out ./latest.json
//
// The signature for each payload is read from "<payload>.sig", which must sit
// next to the payload file (the file tauri build produced next to the bundle).

import { readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    if (eq !== -1) {
      args[arg.slice(2, eq)] = arg.slice(eq + 1);
      continue;
    }
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = value;
      i += 1;
    }
  }
  return args;
}

function fail(message) {
  console.error(`[update-manifest] ${message}`);
  process.exit(1);
}

function main() {
  const args = parseArgs(process.argv);
  const { version, tag, repo, out } = args;

  if (!version || !tag || !repo || !out) {
    fail('缺少必要参数：--version、--tag、--repo、--out');
  }

  const payloadArgs = [];
  for (const [key, value] of Object.entries(args)) {
    if (key.startsWith('payload-')) {
      payloadArgs.push({ target: key.slice('payload-'.length), path: value });
    }
  }
  if (payloadArgs.length === 0) {
    fail('至少需要一个 --payload-<target>=<path> 参数');
  }

  const platforms = {};
  for (const { target, path } of payloadArgs) {
    const sigPath = `${path}.sig`;
    let signature;
    try {
      signature = readFileSync(sigPath, 'utf8').trim();
    } catch {
      fail(`无法读取签名文件 ${sigPath}（tauri build 未生成签名，或 TAURI_SIGNING_PRIVATE_KEY 未配置）`);
    }
    if (!signature) {
      fail(`签名文件 ${sigPath} 内容为空`);
    }
    const name = basename(path);
    const url = `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(name)}`;
    platforms[target] = { signature, url };
  }

  const manifest = {
    version,
    notes: '',
    pub_date: new Date().toISOString(),
    platforms,
  };

  const outPath = out.startsWith('/') ? out : join(process.cwd(), out);
  writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.error(`[update-manifest] wrote ${outPath}`);
  console.log(outPath);
}

main();
