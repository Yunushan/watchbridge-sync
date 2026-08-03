import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["dist/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "json-summary"],
      reportsDirectory: "coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/**/*.d.ts"],
      thresholds: { lines: 55, statements: 50, functions: 40, branches: 60 },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/v1": {
        target: process.env.VITE_API_URL ?? "http://localhost:8080",
        changeOrigin: true,
      },
    },
  },
});
