import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores([
    'dist',
    'android/**',
    'ios/**',
    'node_modules/**',
    'public/sw.js',
    'supabase/functions/**',
  ]),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // React Compiler advisories, not correctness errors. They flag the
      // fetch-on-mount pattern (setLoading inside a load() called from an
      // effect) used by many existing screens, which behaves correctly.
      // Kept visible as warnings so screens are migrated as they are touched.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
    },
  },
  {
    // Node scripts (build, deploy, dev tooling) and tests.
    files: ['scripts/**/*.{js,mjs}', '*.config.js', '**/*.test.js'],
    languageOptions: { globals: { ...globals.node } },
  },
])
