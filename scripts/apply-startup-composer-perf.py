from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected one match, got {count}')
    return text.replace(old, new, 1)


app = Path('src/App.tsx')
text = app.read_text(encoding='utf-8')
text = replace_once(text, "import StandaloneComposerApp from './components/StandaloneComposerApp';\n", '', 'standalone import')
text = replace_once(text, "  isStandaloneComposerWindow,\n", '', 'standalone bridge import')
text = replace_once(
    text,
    "  mockMode,\n  openComposerWindow,\n",
    "  mockMode,\n  openComposerWindow,\n  prewarmComposerWindow,\n",
    'prewarm import',
)
text = replace_once(
    text,
    "export default function App() {\n  if (isStandaloneComposerWindow()) return <StandaloneComposerApp />;\n  return <MailboxApp />;\n}\n",
    "export default function App() {\n  return <MailboxApp />;\n}\n",
    'app root routing',
)
marker = "  const useNativeComposerWindow = !mockMode && nativePlatform === 'desktop';\n"
prewarm = """
  useEffect(() => {
    if (!useNativeComposerWindow || !initialAccountListLoaded) return undefined;
    const timer = window.setTimeout(() => {
      void prewarmComposerWindow().catch(() => undefined);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [initialAccountListLoaded, useNativeComposerWindow]);
"""
text = replace_once(text, marker, marker + prewarm, 'prewarm effect marker')
app.write_text(text, encoding='utf-8')

composer = Path('src/components/ComposerWindow.tsx')
text = composer.read_text(encoding='utf-8')
text = replace_once(
    text,
    "import './composer/composer.css';\n",
    "import './composer/composer.css';\nimport './composer/composer-polish.css';\n",
    'composer polish import',
)
composer.write_text(text, encoding='utf-8')

bridge = Path('src/tauriBridge.ts')
text = bridge.read_text(encoding='utf-8')
marker = """export function openComposerWindow(request: ComposerWindowRequest = {}): Promise<void> {
  if (mockMode) return Promise.resolve();
  return loadProdBridge().then(({ prodOpenComposerWindow }) => prodOpenComposerWindow(request));
}
"""
addition = marker + """
export function prewarmComposerWindow(): Promise<void> {
  if (mockMode) return Promise.resolve();
  return loadProdBridge().then(({ prodPrewarmComposerWindow }) => prodPrewarmComposerWindow());
}

export function showCurrentWindow(): Promise<void> {
  if (mockMode) return Promise.resolve();
  return loadProdBridge().then(({ prodShowCurrentWindow }) => prodShowCurrentWindow());
}
"""
text = replace_once(text, marker, addition, 'bridge composer helpers')
bridge.write_text(text, encoding='utf-8')

prod = Path('src/tauriBridge.prod.ts')
text = prod.read_text(encoding='utf-8')
start_marker = 'let composerWindowCreation: Promise<void> | null = null;'
end_marker = 'export function prodTakePendingComposerRequest()'
start = text.find(start_marker)
end = text.find(end_marker, start)
if start < 0 or end < 0:
    raise SystemExit('prod composer window section not found')
replacement = """let composerWindowCreation: Promise<void> | null = null;

async function focusComposerWindow(window: {
  show: () => Promise<void>;
  unminimize: () => Promise<void>;
  setFocus: () => Promise<void>;
}) {
  await window.show();
  await window.unminimize();
  await window.setFocus();
}

async function ensureComposerWindow(): Promise<void> {
  const { WebviewWindow } = await loadWebviewWindow();
  const existing = await WebviewWindow.getByLabel(COMPOSER_WINDOW_LABEL);
  if (existing) return;
  if (!composerWindowCreation) {
    const composeUrl = new URL(window.location.href);
    composeUrl.search = '?window=compose&prewarm=1';
    composeUrl.hash = '';
    const child = new WebviewWindow(COMPOSER_WINDOW_LABEL, {
      url: composeUrl.toString(),
      title: '写邮件',
      width: 960,
      height: 700,
      minWidth: 760,
      minHeight: 560,
      resizable: true,
      decorations: true,
      titleBarStyle: 'visible',
      hiddenTitle: false,
      focus: false,
      visible: false,
      skipTaskbar: false,
    });
    composerWindowCreation = new Promise<void>((resolve, reject) => {
      void child.once('tauri://created', () => resolve());
      void child.once('tauri://error', (event) => {
        reject(new Error(`无法创建独立写信窗口：${String(event.payload)}`));
      });
    });
  }
  try {
    await composerWindowCreation;
  } finally {
    composerWindowCreation = null;
  }
}

export async function prodPrewarmComposerWindow(): Promise<void> {
  await ensureComposerWindow();
}

export async function prodOpenComposerWindow(request: ComposerWindowRequest): Promise<void> {
  await prodInvoke<void>(IPC.SetPendingComposerRequest, { request });
  const { WebviewWindow } = await loadWebviewWindow();
  const existing = await WebviewWindow.getByLabel(COMPOSER_WINDOW_LABEL);
  if (existing) {
    await existing.emit(COMPOSER_OPEN_EVENT);
    return;
  }
  await ensureComposerWindow();
}

export async function prodShowCurrentWindow(): Promise<void> {
  const { getCurrentWindow: getTauriCurrentWindow } = await loadWindow();
  await focusComposerWindow(getTauriCurrentWindow());
}

"""
text = text[:start] + replacement + text[end:]
old_close = """export async function prodCloseCurrentWindow(): Promise<void> {
  const { getCurrentWindow: getTauriCurrentWindow } = await loadWindow();
  // The native close-request listener deliberately prevents the first close
  // request while it checks for unsaved content. Once React has decided that
  // the window may close, destroy it so this programmatic follow-up cannot
  // re-enter the same close-request cycle.
  await getTauriCurrentWindow().destroy();
}
"""
new_close = """export async function prodCloseCurrentWindow(): Promise<void> {
  const { getCurrentWindow: getTauriCurrentWindow } = await loadWindow();
  const currentWindow = getTauriCurrentWindow();
  if (currentWindow.label === COMPOSER_WINDOW_LABEL) {
    await currentWindow.hide();
    return;
  }
  await currentWindow.destroy();
}
"""
text = replace_once(text, old_close, new_close, 'prod close behavior')
prod.write_text(text, encoding='utf-8')

standalone = Path('src/components/StandaloneComposerApp.tsx')
text = standalone.read_text(encoding='utf-8')
text = replace_once(
    text,
    "  onCurrentWindowCloseRequested,\n  takePendingComposerRequest,\n",
    "  onCurrentWindowCloseRequested,\n  showCurrentWindow,\n  takePendingComposerRequest,\n",
    'show window import',
)
state_marker = "  const applyComposerRequestRef = useRef<(\n"
text = replace_once(
    text,
    state_marker,
    "  const isPrewarmedWindow = new URLSearchParams(window.location.search).get('prewarm') === '1';\n" + state_marker,
    'prewarm window state',
)
old_listener = """        const nextUnlisten = await listenCurrentWindow<unknown>(COMPOSER_OPEN_EVENT, () => {
          if (!bootedRef.current) return;
          takePendingComposerRequest()
            .then((value) => {
              if (!active) return;
              applyComposerRequestRef.current(normalizeComposerRequest(value));
            })
            .catch((error) => setStatus(`读取写信请求失败：${String(error)}`));
        });
"""
new_listener = """        const nextUnlisten = await listenCurrentWindow<unknown>(COMPOSER_OPEN_EVENT, () => {
          if (!bootedRef.current) return;
          closingRef.current = false;
          takePendingComposerRequest()
            .then((value) => {
              if (!active) return;
              const request = normalizeComposerRequest(value);
              applyComposerRequestRef.current(request);
              window.requestAnimationFrame(() => {
                void showCurrentWindow();
              });
              void loadComposerData(request?.draft?.account_id || undefined).catch(() => undefined);
            })
            .catch((error) => setStatus(`读取写信请求失败：${String(error)}`));
        });
"""
text = replace_once(text, old_listener, new_listener, 'composer reopen listener')
old_boot = """        const pending = normalizeComposerRequest(await takePendingComposerRequest());
        await loadComposerData(pending?.draft?.account_id || undefined);
        if (!active) return;
        applyComposerRequestRef.current(pending, true);
        bootedRef.current = true;
        setBooted(true);
"""
new_boot = """        const pending = normalizeComposerRequest(await takePendingComposerRequest());
        await loadComposerData(pending?.draft?.account_id || undefined);
        if (!active) return;
        if (pending || !isPrewarmedWindow) {
          applyComposerRequestRef.current(pending, true);
        }
        bootedRef.current = true;
        setBooted(true);
        if (pending || !isPrewarmedWindow) {
          window.requestAnimationFrame(() => {
            void showCurrentWindow();
          });
        }
"""
text = replace_once(text, old_boot, new_boot, 'composer boot behavior')
text = replace_once(text, "  }, [loadComposerData]);\n", "  }, [isPrewarmedWindow, loadComposerData]);\n", 'composer boot dependencies')
standalone.write_text(text, encoding='utf-8')
