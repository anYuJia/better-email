import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'dist/**', 'src-tauri/**', 'assets/**', 'public/**'] },
  {
    files: ['scripts/**/*.mjs', '*.config.mjs', 'src/**/*.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser }, ecmaVersion: 'latest', sourceType: 'module' },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true }, sourceType: 'module' },
      globals: globals.browser,
    },
    plugins: { '@typescript-eslint': tseslint.plugin, 'react-hooks': reactHooks },
    rules: {
      ...js.configs.recommended.rules,
      'no-undef': 'off',
      'no-unused-vars': 'off',
      'no-redeclare': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'react-hooks/rules-of-hooks': 'error',
      '@typescript-eslint/no-duplicate-enum-values': 'error',
    },
  },
  {
    files: [
      'src/hooks/useComposerRecovery.ts',
      'src/hooks/useMailFeedback.ts',
      'src/hooks/useMobileVisualViewport.ts',
      'src/hooks/usePullToRefresh.ts',
      'src/hooks/useLongPress.ts',
      'src/app/waitForBackgroundTask.ts',
    ],
    languageOptions: { parserOptions: { project: './tsconfig.json', tsconfigRootDir: import.meta.dirname } },
    rules: {
      'react-hooks/exhaustive-deps': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },
];
