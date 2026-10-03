import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['apps/server/**/*.test.ts', 'apps/web/**/*.test.ts', 'packages/shared/**/*.test.ts', 'tests/**/*.test.ts'], testTimeout: 15000 } });
