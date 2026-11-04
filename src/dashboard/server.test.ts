import { afterAll, afterEach, expect, mock, spyOn, test } from "bun:test";
import { handleRequest } from "./server";
import { portfolioApi } from "../kalshi";
const server = Bun.serve({ port: 0, fetch: handleRequest });
afterAll(() => server.stop(true));
afterEach(() => mock.restore());
for (const [path, type] of [["/", "text/html"], ["/index.html", "text/html"], ["/app.js", "text/javascript"], ["/styles.css", "text/css"]]) {
  test(`HTTP serves ${path} with correct content type`, async () => {
    const response = await fetch(new URL(path!, server.url));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain(type!);
    expect((await response.text()).length).toBeGreaterThan(0);
  });
}
test("HTTP rejects unknown paths", async () => {
  expect((await fetch(new URL("/missing", server.url))).status).toBe(404);
});
test("HTTP dashboard returns JSON with no-store", async () => {
  spyOn(portfolioApi, "getBalance").mockResolvedValue({ data: { balance: 0 } } as never);
  spyOn(portfolioApi, "getPositions").mockResolvedValue({ data: { market_positions: [] } } as never);
  spyOn(portfolioApi, "getFills").mockResolvedValue({ data: { fills: [] } } as never);
  const response = await fetch(new URL("/api/dashboard", server.url));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toMatchObject({ positions: { count: 0 } });
});
test("HTTP dashboard returns API errors as JSON", async () => {
  spyOn(portfolioApi, "getBalance").mockRejectedValue(new Error("upstream unavailable"));
  spyOn(portfolioApi, "getPositions").mockResolvedValue({ data: { market_positions: [] } } as never);
  spyOn(portfolioApi, "getFills").mockResolvedValue({ data: { fills: [] } } as never);
  const response = await fetch(new URL("/api/dashboard", server.url));
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "upstream unavailable" });
});
