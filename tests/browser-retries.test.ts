import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithRetry } from "@/components/froglings-workspace";

describe("browser request retries", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each(["/api/debates", "/api/feedback"])("does not duplicate POST %s on a network failure", async (url) => {
    const fetch = vi.fn().mockRejectedValue(new TypeError("Connection lost"));
    vi.stubGlobal("fetch", fetch);
    await expect(fetchWithRetry(url, { method: "POST" })).rejects.toThrow("Connection lost");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not duplicate a debate after a server error", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("{}", { status: 503 }));
    vi.stubGlobal("fetch", fetch);
    expect((await fetchWithRetry("/api/debates", { method: "POST" })).status).toBe(503);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
