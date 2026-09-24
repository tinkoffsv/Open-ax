import { defineConfig } from "vitest/config";

// End-to-end CLI tests scan fixture repositories with git; give them room.
export default defineConfig({ test: { testTimeout: 60_000 } });
