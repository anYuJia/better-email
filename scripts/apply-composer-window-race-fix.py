from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected one match, got {count}')
    return text.replace(old, new, 1)


path = Path('src/components/StandaloneComposerApp.tsx')
text = path.read_text(encoding='utf-8')

text = replace_once(
    text,
    "import useThemeMode from '../hooks/useThemeMode';\n",
    "import useThemeMode from '../hooks/useThemeMode';\nimport { decideComposerBootOpen } from '../app/composerWindowOpenPolicy';\n",
    'policy import',
)

text = replace_once(
    text,
    "  const bootedRef = useRef(false);\n  const closeComposerRef = useRef<() => void>(() => {});\n",
    "  const bootedRef = useRef(false);\n  const openRequestedBeforeBootRef = useRef(false);\n  const closeComposerRef = useRef<() => void>(() => {});\n",
    'open request ref',
)

marker = """  // Draft edits change the controller callback identity. Keep boot and IPC listeners
  // stable so a body edit cannot re-run initialization and steal focus from the editor.
  applyComposerRequestRef.current = applyComposerRequest;

"""
helper = """  // Draft edits change the controller callback identity. Keep boot and IPC listeners
  // stable so a body edit cannot re-run initialization and steal focus from the editor.
  applyComposerRequestRef.current = applyComposerRequest;

  const consumePendingComposerRequest = useCallback(async ({
    restoreWhenMissing = false,
    showWhenMissing = false,
  }: {
    restoreWhenMissing?: boolean;
    showWhenMissing?: boolean;
  } = {}) => {
    const request = normalizeComposerRequest(await takePendingComposerRequest());
    if (!request && !showWhenMissing) {
      openRequestedBeforeBootRef.current = false;
      return false;
    }

    closingRef.current = false;
    applyComposerRequestRef.current(request, restoreWhenMissing);
    openRequestedBeforeBootRef.current = false;
    window.requestAnimationFrame(() => {
      void showCurrentWindow();
    });
    if (request?.draft?.account_id) {
      void loadComposerData(request.draft.account_id).catch(() => undefined);
    }
    return true;
  }, [loadComposerData]);

"""
text = replace_once(text, marker, helper, 'pending consumer')

old_listener = """  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    const register = async () => {
      try {
        const nextUnlisten = await listenCurrentWindow<unknown>(COMPOSER_OPEN_EVENT, () => {
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
        if (active) unlisten = nextUnlisten;
        else nextUnlisten();
      } catch (error) {
        if (active) setStatus(`独立写信窗口通信失败：${String(error)}`);
      }
    };
    void register();
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

"""
new_listener = """  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    const register = async () => {
      try {
        const nextUnlisten = await listenCurrentWindow<unknown>(COMPOSER_OPEN_EVENT, () => {
          openRequestedBeforeBootRef.current = true;
          if (!bootedRef.current) return;
          void consumePendingComposerRequest({ showWhenMissing: true })
            .catch((error) => {
              if (active) setStatus(`读取写信请求失败：${String(error)}`);
            });
        });
        if (active) unlisten = nextUnlisten;
        else nextUnlisten();
      } catch (error) {
        if (active) setStatus(`独立写信窗口通信失败：${String(error)}`);
      }
    };
    void register();
    return () => {
      active = false;
      unlisten?.();
    };
  }, [consumePendingComposerRequest]);

  useEffect(() => {
    const handleWindowFocus = () => {
      openRequestedBeforeBootRef.current = true;
      if (!bootedRef.current) return;
      void consumePendingComposerRequest()
        .catch((error) => setStatus(`恢复写信窗口失败：${String(error)}`));
    };
    window.addEventListener('focus', handleWindowFocus);
    return () => window.removeEventListener('focus', handleWindowFocus);
  }, [consumePendingComposerRequest]);

"""
text = replace_once(text, old_listener, new_listener, 'open listener')

old_boot = """  useEffect(() => {
    let active = true;
    const boot = async () => {
      try {
        const pending = normalizeComposerRequest(await takePendingComposerRequest());
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
      } catch (error) {
        if (!active) return;
        setLoadError(String(error));
      }
    };
    void boot();
    return () => {
      active = false;
    };
  }, [isPrewarmedWindow, loadComposerData]);

"""
new_boot = """  useEffect(() => {
    let active = true;
    const boot = async () => {
      try {
        // Preload stable composer data first. Consume the pending request only
        // after the standalone app is nearly ready, so a click during prewarm
        // cannot be taken too early and then lose its wake-up event.
        await loadComposerData();
        if (!active) return;
        const pending = normalizeComposerRequest(await takePendingComposerRequest());
        if (!active) return;
        const decision = decideComposerBootOpen(
          Boolean(pending),
          isPrewarmedWindow,
          openRequestedBeforeBootRef.current,
        );
        if (decision.shouldOpen) {
          closingRef.current = false;
          applyComposerRequestRef.current(pending, decision.restoreWhenMissing);
          openRequestedBeforeBootRef.current = false;
          if (pending?.draft?.account_id) {
            void loadComposerData(pending.draft.account_id).catch(() => undefined);
          }
        }
        bootedRef.current = true;
        setBooted(true);
        if (decision.shouldOpen) {
          window.requestAnimationFrame(() => {
            void showCurrentWindow();
          });
        } else if (openRequestedBeforeBootRef.current) {
          // Covers the tiny interval between the final pending read and marking
          // the React side booted. The pending request remains authoritative.
          void consumePendingComposerRequest({
            restoreWhenMissing: true,
            showWhenMissing: true,
          }).catch((error) => setStatus(`恢复写信窗口失败：${String(error)}`));
        }
      } catch (error) {
        if (!active) return;
        setLoadError(String(error));
      }
    };
    void boot();
    return () => {
      active = false;
    };
  }, [consumePendingComposerRequest, isPrewarmedWindow, loadComposerData]);

"""
text = replace_once(text, old_boot, new_boot, 'boot flow')

path.write_text(text, encoding='utf-8')
