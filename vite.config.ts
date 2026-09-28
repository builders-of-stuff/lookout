import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";
import { API_ROUTES, upstreamPath } from "./worker/api-routes.ts";

// Free token from https://aqicn.org/data-platform/token/ — put WAQI_TOKEN=… in
// .env.local. It has no VITE_ prefix, so it stays on the dev server.
const { WAQI_TOKEN = "" } = loadEnv("development", process.cwd(), "");

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
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
