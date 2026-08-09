// scripts/ci-prepare-assets.mjs
//
// Renames Tauri bundle outputs to the canonical public artifact names and
// removes non-installer outputs (the raw .app bundle) so they can never be
// uploaded to the GitHub Release.
//
// Usage:
//   node scripts/ci-prepare-assets.mjs --version 1.0.11 [--bundle <dir>]
//
// Prints a JSON payload describing the renamed assets:
//   {
//     "platform": "mac" | "windows",
//     "version": "1.0.11",
//     "installer": { "name": "...", "path": "..." },
//     "payload": { "name": "...", "path": "..." },
//     "signature": { "name": "...", "path": "..." } | null,
//     "removed": ["..."]
//   }

import { readdirSync, existsSync, renameSync, rmSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const bundleRoot = join(root, 'src-tauri', 'target', 'release', 'bundle');

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

function collectFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...collectFiles(full));
    } else {
      files.push(full);
    }
  }
  return files;
}

function findFile(files, predicate, label) {
  const match = files.find(predicate);
  if (!match) {
    throw new Error(`未找到 ${label}：请确认 tauri build 已成功产出对应 bundle。`);
  }
  return match;
}

function main() {
  const { version, bundle } = parseArgs(process.argv);
  if (!version) {
    throw new Error('缺少 --version 参数，例如：node scripts/ci-prepare-assets.mjs --version 1.0.11');
  }
  const resolvedBundleRoot = bundle
    ? (bundle.startsWith('/') ? bundle : join(process.cwd(), bundle))
    : bundleRoot;
  if (!existsSync(resolvedBundleRoot)) {
    throw new Error(`bundle 目录不存在：${resolvedBundleRoot}`);
  }

  const files = collectFiles(resolvedBundleRoot);
  const platform = process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'windows' : process.platform;

  if (platform === 'mac') {
    const dmg = findFile(files, (f) => f.endsWith('.dmg'), 'DMG 安装包');
    const tarGz = findFile(files, (f) => f.endsWith('.app.tar.gz'), 'macOS 更新载荷（.app.tar.gz）');
    const sig = findFile(files, (f) => f.endsWith('.app.tar.gz.sig'), 'macOS 更新签名（.sig）');

    const installerName = `Better_Email_${version}_mac_arm.dmg`;
    const payloadName = `Better_Email_${version}_mac_arm.app.tar.gz`;
    const sigName = `${payloadName}.sig`;

    const installerPath = join(resolvedBundleRoot, 'dmg', installerName);
    const payloadPath = join(resolvedBundleRoot, 'macos', payloadName);
    const sigPath = join(resolvedBundleRoot, 'macos', sigName);

    renameSync(dmg, installerPath);
    renameSync(tarGz, payloadPath);
    renameSync(sig, sigPath);

    // 移除未重命名的 .app bundle，确保永远不会被上传到 Release。
    const appDirs = readdirSync(join(resolvedBundleRoot, 'macos'))
      .filter((entry) => entry.endsWith('.app'));
    for (const dir of appDirs) {
      rmSync(join(resolvedBundleRoot, 'macos', dir), { recursive: true, force: true });
    }

    console.log(JSON.stringify({
      platform,
      version,
      installer: { name: installerName, path: installerPath },
      payload: { name: payloadName, path: payloadPath },
      signature: { name: sigName, path: sigPath },
      removed: appDirs.map((dir) => join(resolvedBundleRoot, 'macos', dir)),
    }, null, 2));
    return;
  }

  if (platform === 'windows') {
    const msi = findFile(files, (f) => f.endsWith('.msi'), 'MSI 安装包');
    const sig = findFile(files, (f) => f.endsWith('.msi.sig'), 'MSI 更新签名（.sig）');

    const installerName = `Better_Email_${version}_windows_x64.msi`;
    const sigName = `${installerName}.sig`;

    const installerPath = join(resolvedBundleRoot, 'msi', installerName);
    const sigPath = join(resolvedBundleRoot, 'msi', sigName);

    renameSync(msi, installerPath);
    renameSync(sig, sigPath);

    console.log(JSON.stringify({
      platform,
      version,
      installer: { name: installerName, path: installerPath },
      payload: { name: installerName, path: installerPath },
      signature: { name: sigName, path: sigPath },
      removed: [],
    }, null, 2));
    return;
  }

  throw new Error(`不支持的发布平台：${platform}（本项目只发布 macOS 与 Windows）。`);
}

try {
  main();
} catch (error) {
  console.error(`[ci-prepare-assets] ${error.message}`);
  process.exit(1);
}
