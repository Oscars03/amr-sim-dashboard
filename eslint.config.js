import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tsParser from '@typescript-eslint/parser'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // Build output and vendored code. Only `dist` was listed before, so
  // `npm run lint` was reporting ~1290 findings from bundled artifacts in
  // release/, out/, dist-electron/ and coverage/ -- all gitignored, none of
  // it ours. simamr_ws is the amr_2dsim ROS package, a separate repo with
  // its own conventions.
  globalIgnores([
    'dist',
    'dist-electron',
    'out',
    'release',
    'build',
    'coverage',
    'graphify-out',
    'simamr_ws',
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
  },
  // Node-side code: the Electron main process, the CommonJS servers, build
  // configs, and tests that read process.env. These all use `process`,
  // `require` and `__dirname`, which the browser globals above do not define.
  {
    files: [
      'electron/**/*.js',
      '**/*.cjs',
      '*.config.js',
      'src/test/**/*.{js,ts}',
      'src/**/*.test.{js,jsx}',
    ],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended],
    languageOptions: {
      parser: tsParser,
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      'no-unused-vars': 'off',
    },
  },
])
