import tseslint from "typescript-eslint";

export default [
  {
    ignores: ["**/node_modules/**", "reports/**", "docs/**"],
  },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ["packages/**/*.ts"],
  })),
];
