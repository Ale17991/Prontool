import { defineConfig, devices } from '@playwright/test'

/**
 * Config Playwright DEDICADA aos E2E da Memed (spec 027 — US5/US6/polish).
 *
 * Separada da playwright.config.ts por segurança: estes testes exigem que o
 * app rode com `MEMED_BASE_URL` apontando para o mock local e com chaves de
 * staging SENTINELA (valores fake, escaneáveis). Reusar um `pnpm dev` já
 * aberto — sem essas envs — faria os testes registrarem prescritores na
 * staging REAL da Memed. Por isso:
 *   - app sobe sempre em :3100 (`reuseExistingServer: false`)
 *   - mock Memed sobe em :4001
 *
 * Rodar com: pnpm test:e2e:memed
 */

/**
 * Chaves-sentinela: NUNCA são válidas na Memed. O teste de leak scan procura
 * por estes valores em todo tráfego/bundle que chega ao navegador — qualquer
 * ocorrência = vazamento (item 5 do registro de aceite).
 */
export const MEMED_E2E_SENTINELS = {
  apiKey: 'E2E_SENTINEL_MEMED_API_KEY_d41d8cd98f00b204e9800998',
  secretKey: 'E2E_SENTINEL_MEMED_SECRET_KEY_a3f5c9e17b2d4068acef13',
} as const

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /memed-.*\.spec\.ts/,
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  // Dev server compila rotas no primeiro hit — o primeiro teste paga esse custo.
  timeout: 180_000,
  reporter: [['html', { outputFolder: 'tests/e2e/artifacts-memed', open: 'never' }], ['list']],
  use: {
    baseURL: 'http://localhost:3100',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm tsx tests/mocks/memed-mock-server.ts --port 4001',
      url: 'http://localhost:4001/__health',
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: 'pnpm dev --port 3100',
      url: 'http://localhost:3100/login',
      reuseExistingServer: false,
      timeout: 240_000,
      env: {
        MEMED_BASE_URL: 'http://localhost:4001',
        MEMED_STAGING_API_KEY: MEMED_E2E_SENTINELS.apiKey,
        MEMED_STAGING_SECRET_KEY: MEMED_E2E_SENTINELS.secretKey,
      },
    },
  ],
})
