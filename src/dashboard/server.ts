import "dotenv/config";
import { join } from "node:path";
import { getDashboardData } from "./data";

const root = new URL(".", import.meta.url).pathname;
const port = Number(Bun.env.DASHBOARD_PORT ?? 3000);

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

function staticResponse(pathname: string): Response {
  const fileName = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = join(root, fileName);
  const ext = fileName.slice(fileName.lastIndexOf("."));
  return new Response(Bun.file(filePath), {
    headers: { "content-type": contentTypes[ext] ?? "application/octet-stream" },
  });
}

Bun.serve({
  port,
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/api/dashboard") {
      try {
        return Response.json(await getDashboardData(), {
          headers: { "cache-control": "no-store" },
        });
      } catch (error) {
        return Response.json(
          { error: error instanceof Error ? error.message : String(error) },
          { status: 500 },
        );
      }
    }

    if (["/", "/index.html", "/styles.css", "/app.js"].includes(url.pathname)) {
      return staticResponse(url.pathname);
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`Dashboard running at http://localhost:${port}`);
