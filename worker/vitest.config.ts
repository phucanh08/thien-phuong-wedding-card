import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      // Test chỉ dùng R2 giả lập của Miniflare, không chạm tài nguyên Cloudflare thật.
      remoteBindings: false,
    }),
  ],
});
