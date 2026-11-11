import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Windows 图标资源契约（纯资源/源码校验，不依赖 Windows 实机）：
 * 1. tauri.conf.json 声明的 bundle.icon 全部存在；
 * 2. icon.ico 必须包含 16/20/24/32/40/48/64/128/256 等尺寸；
 * 3. 当前根 icons 与 v5 的共享资源校验和一致；
 * 4. 托盘、主窗口与移动端构建使用 v5 源资源。
 * 实机上的任务栏 / Alt+Tab / 通知区 / MSI 显示必须另行在 Windows 上验收。
 */
const iconsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(iconsDir, '..', '..');

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function listSharedNames() {
  const candidates = [
    '32x32.png',
    '64x64.png',
    '128x128.png',
    '128x128@2x.png',
    'icon.icns',
    'icon.ico',
    'icon.png',
    'tray-icon.png',
    'tray-icon@2x.png',
    'tray-icon-light.png',
    'tray-icon-dark.png',
    'Square30x30Logo.png',
    'Square44x44Logo.png',
    'Square71x71Logo.png',
    'Square89x89Logo.png',
    'Square107x107Logo.png',
    'Square142x142Logo.png',
    'Square150x150Logo.png',
    'Square284x284Logo.png',
    'Square310x310Logo.png',
    'StoreLogo.png',
  ];
  // 旧版本资源保留供追溯，不应与当前版本强制保持一致。
  return candidates.filter((name) => (
    existsSync(join(iconsDir, name))
    && existsSync(join(iconsDir, 'v5', name))
  ));
}

function icoSizes(icoPath) {
  const data = readFileSync(icoPath);
  if (data[0] !== 0 || data[1] !== 0 || data[2] !== 1 || data[3] !== 0) {
    throw new Error(`${icoPath} 不是有效的 ICO 文件`);
  }
  const count = data.readUInt16LE(4);
  const sizes = new Set();
  for (let i = 0; i < count; i += 1) {
    const width = data[6 + i * 16] || 256;
    const height = data[7 + i * 16] || 256;
    sizes.add(`${width}x${height}`);
  }
  return sizes;
}

describe('Windows 图标资源契约', () => {
  it('tauri.conf.json 声明的 bundle.icon 文件全部存在', () => {
    const configPath = join(repoRoot, 'src-tauri', 'tauri.conf.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    const icons = config.bundle.icon;
    expect(Array.isArray(icons)).toBe(true);
    expect(icons.length).toBeGreaterThanOrEqual(7);
    for (const relative of icons) {
      const absolute = join(repoRoot, 'src-tauri', relative);
      expect(() => readFileSync(absolute), `${relative} 不存在`).not.toThrow();
    }
  });

  it('icon.ico 覆盖 16/20/24/32/40/48/64/128/256 尺寸', () => {
    const sizes = icoSizes(join(iconsDir, 'icon.ico'));
    for (const expected of ['16x16', '20x20', '24x24', '32x32', '40x40', '48x48', '64x64', '128x128', '256x256']) {
      expect(sizes.has(expected), `缺少 ${expected}`).toBe(true);
    }
  });

  it('根 icons 与当前 v5 的共享资源校验和一致', () => {
    for (const name of listSharedNames()) {
      const root = sha256(join(iconsDir, name));
      expect(root, `${name}: 根与 v5 不一致`).toBe(sha256(join(iconsDir, 'v5', name)));
    }
  });

  it('统一 SVG 主源及托盘矢量文件存在且有效（无渐变、克制色调）', () => {
    const brandDir = join(repoRoot, 'assets', 'brand');
    const svgNames = [
      'better-email-symbol.svg',
      'app-icon.svg',
      'tray-icon-dark.svg',
      'tray-icon-light.svg',
    ];
    for (const name of svgNames) {
      const path = join(brandDir, name);
      expect(existsSync(path), `缺少矢量主源 ${name}`).toBe(true);
      const content = readFileSync(path, 'utf8');
      expect(content).toContain('<svg');
      expect(content).toContain('</svg>');
      // 严格遵循 Better Email 克制、无渐变设计规范
      expect(content.includes('<linearGradient'), `${name} 不应包含渐变色定义`).toBe(false);
    }
  });

  it('应用主图标与旧版 Git Blob SHA 相比已真实更新，且与 evidence 一致', () => {
    const iconPath = join(iconsDir, 'icon.png');
    const icoPath = join(iconsDir, 'icon.ico');
    const evidencePath = join(repoRoot, 'docs', 'design', 'evidence', 'app-icon.png');

    expect(existsSync(evidencePath), '缺少 docs/design/evidence/app-icon.png').toBe(true);
    expect(sha256(evidencePath), 'evidence/app-icon.png 必须与最新生成的 icon.png 一致').toBe(sha256(iconPath));

    // 旧版遗留占位图 SHA（Commit 04d804b 之前长期未更新的 blob）
    const legacyIconSha = '639da2784cf2916b7189d533b3d2b2c9383685642d6c66cf174eec7f53a1a9e8';
    const legacyIcoSha = '3671a4f107ee628bf0bb130bf7b5b542e0573bead5ba2a7d45f62df944f9c614';
    expect(sha256(iconPath)).not.toBe(legacyIconSha);
    expect(sha256(icoPath)).not.toBe(legacyIcoSha);
  });

  it('托盘和主窗口使用当前版本，macOS 托盘使用模板图标，Windows 托盘适配主题', () => {
    const libSource = readFileSync(join(repoRoot, 'src-tauri', 'src', 'lib.rs'), 'utf8');
    const trayInclude = libSource.match(/include_bytes!\("\.\.\/icons\/([^"]*tray-icon\.png)"\)/);
    expect(trayInclude, 'lib.rs 中未找到托盘图标 include_bytes').not.toBeNull();
    const windowIconInclude = libSource.match(/include_bytes!\("\.\.\/icons\/v5\/icon\.png"\)/);
    expect(windowIconInclude, 'lib.rs 中未找到主窗口图标 include_bytes').not.toBeNull();

    const trayPath = trayInclude[1].startsWith('v5/')
      ? join(iconsDir, trayInclude[1])
      : join(iconsDir, 'v5', trayInclude[1].split('/').pop());
    expect(sha256(trayPath)).toBe(sha256(join(iconsDir, 'tray-icon.png')));
    expect(sha256(join(iconsDir, 'v5', 'icon.png'))).toBe(sha256(join(iconsDir, 'icon.png')));
    expect(libSource).toContain('.icon_as_template(cfg!(target_os = "macos"))');
    expect(libSource).toContain('tray-icon-dark.png');
    expect(libSource).toContain('tray-icon-light.png');
  });

  it('Android 构建安装自适应图标及单色图层', () => {
    const adaptive = readFileSync(join(iconsDir, 'v5/android/mipmap-anydpi-v26/ic_launcher.xml'), 'utf8');
    expect(adaptive).toContain('@mipmap/ic_launcher_foreground');
    expect(adaptive).toContain('@mipmap/ic_launcher_background');
    expect(adaptive).toContain('@mipmap/ic_launcher_monochrome');
    expect(readFileSync(join(iconsDir, 'v5/android/mipmap-anydpi-v26/ic_launcher_round.xml'), 'utf8')).toBe(adaptive);
    for (const workflow of ['android.yml', 'release.yml']) {
      expect(readFileSync(join(repoRoot, '.github/workflows', workflow), 'utf8'))
        .toContain('cp -R src-tauri/icons/v5/android/. src-tauri/gen/android/app/src/main/res/');
    }
  });

  it('iOS 主图为 1024 像素且不包含 alpha 通道', () => {
    const icon = readFileSync(join(iconsDir, 'v5/ios/AppIcon-512@2x.png'));
    expect(icon.readUInt32BE(16)).toBe(1024);
    expect(icon.readUInt32BE(20)).toBe(1024);
    expect(icon[25]).toBe(2); // PNG truecolor (RGB), no alpha channel
  });

  it('不伪造 Windows 实机验收：本测试只校验资源与源码引用', () => {
    // 任务栏、Alt+Tab、通知区托盘与 MSI 快捷方式的真实显示
    // 必须由 Windows 实机验收完成；本测试绝不冒充实机结果。
    // 若在 Windows 上运行，这些资源校验同样成立（与平台无关）。
    expect(true).toBe(true);
  });
});
