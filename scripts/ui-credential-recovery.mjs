export async function testCredentialRecovery({ cdp, evaluate, wait, screenshot, fill, click, openAccountSwitcher }) {
  await wait(cdp, "document.querySelectorAll('.message-card').length > 0");
  await evaluate(cdp, `(async () => {
    const { invoke } = await import('/src/tauriBridge.ts');
    const accounts = await invoke('list_accounts');
    const target = accounts.find((account) => account.id === 2);
    if (!target) throw new Error('Recovery fixture missing');
    window.__credentialRecovery = { target, count: accounts.length,
      scope: document.querySelector('.account-switcher')?.getAttribute('data-account-scope') ?? 'all' };
    await invoke('delete_account_secret', { accountEmail: target.email });
    window.dispatchEvent(new Event('better-email:credentials-changed'));
  })()`);
  await wait(cdp, "document.querySelector('.account-login-recovery')?.innerText.includes('design@better-email.local')");
  const verifyGeometry = async () => evaluate(cdp, `(() => {
    const panel = document.querySelector('.account-login-recovery');
    if (!panel) throw new Error('Missing recovery notice');
    const button = panel.querySelector('button');
    const area = button.getBoundingClientRect();
    const container = panel.getBoundingClientRect();
    if (area.height < 44 || area.left < container.left || area.right > container.right + 1) throw new Error('Recovery action clipped');
    const hit = document.elementFromPoint(area.left + area.width / 2, area.top + area.height / 2);
    if (hit !== button && !button.contains(hit)) throw new Error('Recovery action covered');
    if (document.documentElement.scrollWidth > innerWidth + 1) throw new Error('Recovery notice causes horizontal overflow');
  })()`);
  await verifyGeometry();
  await screenshot(cdp, 'credential-repair-desktop');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await wait(cdp, "document.querySelector('.app-shell.is-mobile-app .account-login-recovery')");
  await verifyGeometry();
  await screenshot(cdp, 'credential-repair-mobile');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 980, deviceScaleFactor: 1, mobile: false });
  await wait(cdp, "!document.querySelector('.app-shell.is-mobile-app')");
  await click(cdp, '修复登录', "[...document.querySelectorAll('.account-login-recovery-row')].find(row => row.querySelector('b')?.textContent === 'design@better-email.local')");
  await wait(cdp, "document.querySelector('.settings-page[data-settings-page=auth] .settings-credential-panel')?.innerText.includes('design@better-email.local')");
  await screenshot(cdp, 'credential-repair-bound-account');
  await fill(cdp, '.settings-credential-panel input', 'test-only-recovery-code');
  await click(cdp, '保存并验证', "document.querySelector('.settings-credential-panel')");
  await wait(cdp, "document.querySelector('.settings-credential-panel input')?.value === '' && document.querySelector('.status-line')?.innerText.includes('登录验证通过')");
  await evaluate(cdp, `(async () => {
    const { invoke } = await import('/src/tauriBridge.ts');
    const before = window.__credentialRecovery;
    const accounts = await invoke('list_accounts');
    const target = accounts.find((account) => account.id === before.target.id);
    if (accounts.length !== before.count || target?.email !== before.target.email) throw new Error('Recovery recreated the account');
    const status = await invoke('check_account_secret', { accountEmail: target.email });
    if (!status.exists) throw new Error('Saved credential is not readable');
  })()`);
  await screenshot(cdp, 'credential-repair-verified');
  await evaluate(cdp, "document.querySelector('.settings-modal [aria-label=\"关闭设置\"]').click()");
  await wait(cdp, "!document.querySelector('.settings-modal') && !document.querySelector('.account-login-recovery') && document.querySelector('.message-list')");
  const scope = await evaluate(cdp, 'window.__credentialRecovery.scope');
  const item = `[data-context-item="account-scope-${scope}"]`;
  await openAccountSwitcher(cdp, item);
  await evaluate(cdp, `document.querySelector(${JSON.stringify(item)}).click()`);
  await wait(cdp, `document.querySelector('.account-switcher[data-account-scope="${scope}"]') && document.querySelectorAll('.message-card').length > 0`);
}
