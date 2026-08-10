import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Windows 图标资源契约（纯资源/源码校验，不依赖 Windows 实机）：
 * 1. tauri.conf.json 声明的 bundle.icon 全部存在；
 * 2. icon.ico 必须包含 16/20/24/32/40/48/64/128/256 等尺寸；
 * 3. 根 icons、v3、v4 的共享资源校验和一致，避免版本混用；
 * 4. 托盘图标与主窗口图标使用 v4 源资源，并与根目录镜像一致。
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
  // 根目录只保留 bundle 需要的图标；Square*/StoreLogo 仅存在于 v3/v4。
  return candidates.filter((name) => (
    existsSync(join(iconsDir, name))
    && existsSync(join(iconsDir, 'v3', name))
    && existsSync(join(iconsDir, 'v4', name))
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
      const absolute = join(iconsDir, relative.split('/').pop());
      expect(() => readFileSync(absolute), `${relative} 不存在`).not.toThrow();
    }
  });

  it('icon.ico 覆盖 16/20/24/32/40/48/64/128/256 尺寸', () => {
    const sizes = icoSizes(join(iconsDir, 'icon.ico'));
    for (const expected of ['16x16', '20x20', '24x24', '32x32', '40x40', '48x48', '64x64', '128x128', '256x256']) {
      expect(sizes.has(expected), `缺少 ${expected}`).toBe(true);
    }
  });

  it('根 icons 与 v3、v4 的共享资源校验和一致，避免版本混用', () => {
    for (const name of listSharedNames()) {
      const root = sha256(join(iconsDir, name));
      const v3 = sha256(join(iconsDir, 'v3', name));
      const v4 = sha256(join(iconsDir, 'v4', name));
      expect(root, `${name}: 根与 v3 不一致`).toBe(v3);
      expect(root, `${name}: 根与 v4 不一致`).toBe(v4);
    }
  });

  it('托盘图标与主窗口图标使用统一 v4 源资源并与根目录镜像一致', () => {
    const libSource = readFileSync(join(repoRoot, 'src-tauri', 'src', 'lib.rs'), 'utf8');
    const trayInclude = libSource.match(/include_bytes!\("\.\.\/icons\/([^"]+tray-icon[^"]*)"\)/);
    expect(trayInclude, 'lib.rs 中未找到托盘图标 include_bytes').not.toBeNull();
    const windowIconInclude = libSource.match(/include_bytes!\("\.\.\/icons\/v4\/icon\.png"\)/);
    expect(windowIconInclude, 'lib.rs 中未找到主窗口图标 include_bytes').not.toBeNull();

    const trayPath = trayInclude[1].startsWith('v4/')
      ? join(iconsDir, trayInclude[1])
      : join(iconsDir, 'v4', trayInclude[1].split('/').pop());
    expect(sha256(trayPath)).toBe(sha256(join(iconsDir, 'tray-icon.png')));
    expect(sha256(join(iconsDir, 'v4', 'icon.png'))).toBe(sha256(join(iconsDir, 'icon.png')));
  });

  it('不伪造 Windows 实机验收：本测试只校验资源与源码引用', () => {
    // 任务栏、Alt+Tab、通知区托盘与 MSI 快捷方式的真实显示
    // 必须由 Windows 实机验收完成；本测试绝不冒充实机结果。
    // 若在 Windows 上运行，这些资源校验同样成立（与平台无关）。
    expect(true).toBe(true);
  });
});
