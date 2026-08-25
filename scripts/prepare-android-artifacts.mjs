#!/usr/bin/env node

import { access, copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

function parseArgs(argv) {
  const values = new Map();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help' || token === '-h') {
      values.set('help', 'true');
      continue;
    }
    if (!token.startsWith('--')) {
      throw new Error(`Unexpected argument: ${token}`);
    }

    const withoutPrefix = token.slice(2);
    const equalsIndex = withoutPrefix.indexOf('=');
    if (equalsIndex >= 0) {
      values.set(withoutPrefix.slice(0, equalsIndex), withoutPrefix.slice(equalsIndex + 1));
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      throw new Error(`Missing value for --${withoutPrefix}`);
    }
    values.set(withoutPrefix, next);
    index += 1;
  }

  return values;
}

function usage() {
  return `Usage: node scripts/prepare-android-artifacts.mjs [options]

Signs the release APK and AAB produced by Tauri and copies them to the release
asset directory. The Android signing secrets are read from the environment:

  ANDROID_KEY_BASE64
  ANDROID_KEY_ALIAS
  ANDROID_KEYSTORE_PASSWORD
  ANDROID_KEY_PASSWORD

Options:
  --outputs <dir>  Android Gradle outputs directory
  --output <dir>   Directory for the named release artifacts
  --version <ver>  Application version used in the artifact names
`;
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function listFiles(root) {
  const result = [];
  const pending = [root];

  while (pending.length > 0) {
    const current = pending.pop();
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(path);
      } else if (entry.isFile()) {
        result.push(path);
      }
    }
  }

  return result;
}

function selectArtifact(files, extension, label) {
  const candidates = files.filter((path) => path.toLowerCase().endsWith(extension));
  const usable = candidates.filter((path) => !path.toLowerCase().includes('debug'));

  if (usable.length === 0) {
    throw new Error(`No release ${label} found in the Android build outputs`);
  }

  const unsigned = usable.filter((path) => path.toLowerCase().includes('unsigned'));
  if (unsigned.length === 1) {
    return unsigned[0];
  }

  const universal = usable.filter((path) => path.toLowerCase().includes('universal'));
  if (universal.length === 1) {
    return universal[0];
  }

  if (usable.length === 1) {
    return usable[0];
  }

  throw new Error(
    `Expected one ${label}, found multiple candidates:\n${usable.map((path) => `  ${path}`).join('\n')}`,
  );
}

async function run(command, args, options = {}) {
  try {
    return await execFileAsync(command, args, {
      ...options,
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (error) {
    const stdout = typeof error.stdout === 'string' ? error.stdout.trim() : '';
    const stderr = typeof error.stderr === 'string' ? error.stderr.trim() : '';
    const details = [stdout, stderr].filter(Boolean).join('\n');
    const secrets = [
      process.env.ANDROID_KEYSTORE_PASSWORD,
      process.env.ANDROID_KEY_PASSWORD,
    ].filter(Boolean);
    const safeArgs = args.map((argument) =>
      secrets.reduce((safe, secret) => safe.replaceAll(secret, '***'), argument),
    );
    throw new Error(`${command} ${safeArgs.join(' ')} failed${details ? `:\n${details}` : ''}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.has('help')) {
    console.log(usage());
    return;
  }

  const outputs = resolve(args.get('outputs') ?? 'src-tauri/gen/android/app/build/outputs');
  const output = resolve(args.get('output') ?? 'release-assets');
  const version = args.get('version') ?? readPackageVersion();
  if (!/^[0-9A-Za-z._-]+$/.test(version)) {
    throw new Error(`Unsafe Android artifact version: ${version}`);
  }
  if (!(await exists(outputs))) {
    throw new Error(`Android build outputs directory does not exist: ${outputs}`);
  }

  const keyAlias = process.env.ANDROID_KEY_ALIAS;
  const storePassword = process.env.ANDROID_KEYSTORE_PASSWORD || process.env.ANDROID_KEY_PASSWORD;
  const keyPassword = process.env.ANDROID_KEY_PASSWORD || storePassword;
  if (!keyAlias || !storePassword || !keyPassword) {
    throw new Error(
      'ANDROID_KEY_ALIAS, ANDROID_KEYSTORE_PASSWORD and ANDROID_KEY_PASSWORD must be configured',
    );
  }

  let keystore = process.env.ANDROID_KEYSTORE_PATH;
  let temporaryKeystoreDirectory;
  if (!keystore) {
    const encoded = process.env.ANDROID_KEY_BASE64?.replace(/\s/g, '');
    if (!encoded) {
      throw new Error('ANDROID_KEY_BASE64 or ANDROID_KEYSTORE_PATH must be configured');
    }
    const decoded = Buffer.from(encoded, 'base64');
    if (decoded.length < 128) {
      throw new Error('ANDROID_KEY_BASE64 did not decode to a valid-looking keystore');
    }
    temporaryKeystoreDirectory = await mkdtemp(join(tmpdir(), 'better-email-android-'));
    keystore = join(temporaryKeystoreDirectory, 'release.keystore');
    await writeFile(keystore, decoded, { mode: 0o600 });
  }

  const sdkRoot = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME;
  const buildToolsVersion = process.env.ANDROID_BUILD_TOOLS_VERSION || '36.0.0';
  if (!sdkRoot) {
    throw new Error('ANDROID_SDK_ROOT or ANDROID_HOME must be configured');
  }
  const buildTools = join(sdkRoot, 'build-tools', buildToolsVersion);
  const apksigner = join(buildTools, process.platform === 'win32' ? 'apksigner.bat' : 'apksigner');
  const zipalign = join(buildTools, process.platform === 'win32' ? 'zipalign.exe' : 'zipalign');
  if (!(await exists(apksigner)) || !(await exists(zipalign))) {
    throw new Error(`Android build-tools ${buildToolsVersion} were not found at ${buildTools}`);
  }
  if (!(await exists(keystore))) {
    throw new Error(`Android keystore does not exist: ${keystore}`);
  }

  await mkdir(output, { recursive: true });
  const files = await listFiles(outputs);
  const apk = selectArtifact(files, '.apk', 'APK');
  const aab = selectArtifact(files, '.aab', 'AAB');
  const temporaryArtifacts = await mkdtemp(join(tmpdir(), 'better-email-android-'));
  const alignedApk = join(temporaryArtifacts, 'release-aligned.apk');
  const signedApk = join(temporaryArtifacts, 'release-signed.apk');
  const signedAab = join(temporaryArtifacts, 'release-signed.aab');
  const apkOutput = join(output, `Better_Email_${version}_android_arm64.apk`);
  const aabOutput = join(output, `Better_Email_${version}_android_arm64.aab`);
  const childEnv = {
    ...process.env,
    ANDROID_KEYSTORE_PASSWORD: storePassword,
    ANDROID_KEY_PASSWORD: keyPassword,
  };

  try {
    await run(zipalign, ['-f', '-p', '4', apk, alignedApk]);
    await run(
      apksigner,
      [
        'sign',
        '--ks',
        keystore,
        '--ks-key-alias',
        keyAlias,
        '--ks-pass',
        'env:ANDROID_KEYSTORE_PASSWORD',
        '--key-pass',
        'env:ANDROID_KEY_PASSWORD',
        '--out',
        signedApk,
        alignedApk,
      ],
      { env: childEnv },
    );
    await run(apksigner, ['verify', '--verbose', signedApk]);

    await run(
      'jarsigner',
      [
        '-keystore',
        keystore,
        '-storepass',
        storePassword,
        '-keypass',
        keyPassword,
        '-sigalg',
        'SHA256withRSA',
        '-digestalg',
        'SHA-256',
        '-signedjar',
        signedAab,
        aab,
        keyAlias,
      ],
      { env: childEnv },
    );
    await run(
      'jarsigner',
      ['-verify', '-keystore', keystore, '-storepass', storePassword, signedAab],
      { env: childEnv },
    );

    await copyFile(signedApk, apkOutput);
    await copyFile(signedAab, aabOutput);
    console.log(`Signed Android APK: ${apkOutput}`);
    console.log(`Signed Android AAB: ${aabOutput}`);
  } finally {
    await rm(temporaryArtifacts, { recursive: true, force: true });
    if (temporaryKeystoreDirectory) {
      await rm(temporaryKeystoreDirectory, { recursive: true, force: true });
    }
  }
}

function readPackageVersion() {
  const packageJson = require('../package.json');
  return packageJson.version;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
