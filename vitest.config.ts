import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    exclude: ["tests/browser/**", "node_modules/**"],
    coverage: {
      reporter: ["text", "html"],
    },
  },
});
