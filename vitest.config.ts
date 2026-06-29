import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    globals: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["server/**/*.ts", "lib/**/*.ts", "inngest/**/*.ts"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
      // Tests run in Node and don't have the Next "server-only" sentinel —
      // map the import to an empty module so repo files load cleanly.
      "server-only": path.resolve(__dirname, "tests/shims/server-only.ts"),
    },
  },
});
