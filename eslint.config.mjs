import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/build/**",
      "**/coverage/**",
      "**/*.d.ts",
      "**/next-env.d.ts",
      "**/next.config.mjs",
      "**/*.config.ts",
      "apps/web/public/sw.js",
      ".venv/**",
      ".packages/**",
      "data/**",
      "app/**",
      "static/**",
      "templates/**",
      "tests/**",
      "scripts/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);
