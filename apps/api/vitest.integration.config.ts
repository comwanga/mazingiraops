import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/integration/**/*.int-spec.ts"],
    globals: false,
    globalSetup: ["test/integration/global-setup.ts"],
    setupFiles: ["test/integration/setup.ts"],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
