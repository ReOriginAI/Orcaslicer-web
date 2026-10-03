import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const externalUrl = process.env.ORCA_TEST_URL;
const testPort = process.env.ORCA_TEST_PORT ?? '18084';
const testUrl = `http://127.0.0.1:${testPort}`;
export default defineConfig({
  testDir: './tests/browser',
  timeout: 180000,
  expect: { timeout: 15000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: { baseURL: externalUrl ?? testUrl, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl'] } } }],
  webServer: externalUrl ? undefined : {
    command: 'pnpm build && pnpm start',
    url: `${testUrl}/api/health`,
    timeout: 120000,
    reuseExistingServer: false,
    env: { HOST: '127.0.0.1', PORT: testPort, DATA_DIR: process.env.ORCA_BROWSER_DATA_DIR ?? mkdtempSync(join(tmpdir(), 'orca-web-browser-')) },
  },
});
