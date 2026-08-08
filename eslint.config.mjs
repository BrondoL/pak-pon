import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      // ignoreRestSiblings: rest-destructuring adalah cara idiomatik membuang
      // field (lihat components/add-items-modal.tsx). Variabelnya terhapus
      // saat kompilasi; memaksa bentuk lain cuma bikin kodenya lebih jelek.
      //
      // argsIgnorePattern/varsIgnorePattern "^_": konvensi repo ini untuk
      // "sengaja tidak dipakai" — misalnya parameter `_request` yang wajib
      // ada di signature route handler Next tapi tidak dipakai isinya
      // (`app/api/monitor/route.ts`). Prefix underscore menandai itu niat,
      // bukan lupa.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { ignoreRestSiblings: true, argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
]);

export default eslintConfig;
