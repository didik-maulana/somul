import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  {
    // `website` is a separate package with its own ESLint config; linting it from here loads
    // eslint-config-next through this config's plugins and fails before reaching any rule.
    ignores: ['dist', 'src-tauri/target', 'src-tauri/gen', 'coverage', 'website'],
  },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  reactHooks.configs.flat['recommended-latest'],
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'react-refresh': reactRefresh,
    },
    rules: {
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // src/lib/ipc.ts is the only tauri-api import site, which is what
      // keeps the frontend testable without a Tauri runtime.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@tauri-apps/api', '@tauri-apps/api/*', '@tauri-apps/plugin-*'],
              message:
                'Import the typed wrappers from @/lib/ipc instead. Only src/lib/ipc.ts may touch @tauri-apps/api, which is what keeps the frontend testable without a Tauri runtime.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/lib/ipc.ts'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
  {
    files: ['**/*.{js,mjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: globals.node,
    },
  },
);
