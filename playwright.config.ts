import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/browser",
  fullyParallel: false,
  use: {
    baseURL: "https://127.0.0.1:4173",
    trace: "retain-on-failure",
    ignoreHTTPSErrors: true,
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run preview -- --host 127.0.0.1 --port 4173",
    url: "https://127.0.0.1:4173",
    ignoreHTTPSErrors: true,
    reuseExistingServer: true,
  },
});
