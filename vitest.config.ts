import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./tests/helpers/setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    include: ['tests/**/*.spec.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**', '.next/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      exclude: [
        'node_modules/**',
        '.next/**',
        'tests/**',
        '**/*.config.*',
        'src/lib/db/generated/**',
      ],
    },
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
  resolve: {
    // Vite matches aliases in declaration order, first match wins. The bare
    // `@` prefix must come last or it swallows `@/tests/*` before the
    // specific alias has a chance to match.
    alias: [
      { find: /^@\/tests\/(.*)$/, replacement: resolve(__dirname, './tests/$1') },
      { find: /^@\/app\/(.*)$/, replacement: resolve(__dirname, './src/app/$1') },
      { find: /^@\/lib\/(.*)$/, replacement: resolve(__dirname, './src/lib/$1') },
      { find: /^@\/components\/(.*)$/, replacement: resolve(__dirname, './src/components/$1') },
      { find: /^@\/(.*)$/, replacement: resolve(__dirname, './src/$1') },
    ],
  },
})
