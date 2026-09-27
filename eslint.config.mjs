import js from "@eslint/js";
import tseslint from "typescript-eslint";
import nextPlugin from "@next/eslint-plugin-next";
import globals from "globals";

export default tseslint.config(
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        plugins: {
            "@next/next": nextPlugin,
        },
        rules: {
            ...nextPlugin.configs.recommended.rules,
            ...nextPlugin.configs["core-web-vitals"].rules,
        },
        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.node,
            },
        },
    },
    {
        ignores: [
            ".next/**",
            "node_modules/**",
            // Local scratch — prototypes and one-off experiments, not part
            // of the app or the data pipeline. Linting it only lets a
            // half-finished experiment fail `npm run verify` for whoever is
            // running it, which CI would never have seen either way.
            "scripts/_local/**",
            "out/**",
            "coverage/**",
            "lint_report.json",
            "arabic-book-corpus-platform/**",
            "arabic-book-corpus-platform/**/.next/**",
            "arabic-book-corpus-platform/**/dist/**",
            "arabic-book-corpus-platform/**/coverage/**"
        ],
    },
    {
        files: ["scripts/**/*.js"],
        languageOptions: {
            globals: {
                ...globals.node,
            },
        },
        rules: {
            "@typescript-eslint/no-var-requires": "off",
            "@typescript-eslint/no-require-imports": "off",
            "no-undef": "off"
        }
    },
    {
        rules: {
            "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
            "@typescript-eslint/no-explicit-any": "warn",
        },
    }
);
