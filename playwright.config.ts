import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  // E2E da Memed rodam SÓ via playwright.memed.config.ts (exigem o mock da
  // Memed em :4001 + envs específicas). Ver pnpm test:e2e:memed.
  testIgnore: /memed-.*\.spec\.ts/,
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Dev server compiles pages lazily; running multiple workers hammers a
  // single Node process and makes first-hit timing flaky. CI uses the prod
  // build and can parallelise.
  workers: 1,
  reporter: [['html', { outputFolder: 'tests/e2e/artifacts' }], ['list']],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: process.env.CI ? 'pnpm start' : 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
})
