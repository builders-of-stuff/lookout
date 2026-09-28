import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";
import { API_ROUTES, upstreamPath } from "./worker/api-routes.ts";
import { quotaResponse } from "./worker/quota.ts";

// Free token from https://aqicn.org/data-platform/token/ — put WAQI_TOKEN=… in
// .env.local. It has no VITE_ prefix, so it stays on the dev server. The usage
// meter reads ANALYTICS_TOKEN and ANALYTICS_ACCOUNT_ID from there too.
const {
  WAQI_TOKEN = "",
  ANALYTICS_TOKEN,
  ANALYTICS_ACCOUNT_ID,
} = loadEnv("development", process.cwd(), "");

export default defineConfig({
  plugins: [
    tailwindcss(),
    sveltekit(),
    {
      name: "lookout-quota",
      configureServer(server) {
        server.middlewares.use("/api/quota", async (_req, res) => {
          const answer = await quotaResponse(ANALYTICS_TOKEN, ANALYTICS_ACCOUNT_ID);
          res.statusCode = answer.status;
          res.setHeader("Content-Type", "application/json");
          res.end(await answer.text());
        });
      },
    },
  ],
  server: {
    port: 5173,
    proxy: Object.fromEntries(
      Object.entries(API_ROUTES).map(([name, route]) => {
        const prefix = `/api/${name}`;
        return [
          prefix,
          {
            target: route.origin,
            changeOrigin: true,
            headers: route.headers,
            rewrite: (path: string) =>
              upstreamPath(route, path.slice(prefix.length), WAQI_TOKEN),
          },
        ];
      }),
    ),
  },
});
