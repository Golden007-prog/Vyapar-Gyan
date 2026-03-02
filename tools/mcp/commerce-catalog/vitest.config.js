import { defineConfig } from "vitest/config";
export default defineConfig({
    test: {
        globals: true,
        environment: "node",
        coverage: {
            provider: "v8",
            reporter: ["text", "json", "html"],
            exclude: [
                "node_modules/",
                "dist/",
                "src/**/*.test.ts",
                "src/**/*.property.test.ts",
            ],
        },
    },
});
//# sourceMappingURL=vitest.config.js.map