import { afterEach, expect, it, vi } from "vitest";
import { getPublicStats } from "@/server/stats";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it("counts all Firestore pages rather than just the recent-debate list", async () => {
  vi.stubEnv("FIRESTORE_PROJECT_ID", "stats-test-project");
  vi.stubEnv("GOOGLE_OAUTH_ACCESS_TOKEN", "test-token");
  function document(index: number) {
    return { fields: { recordJson: { stringValue: JSON.stringify({
      id: `debate_${index}`, status: index % 2 ? "failed" : "complete",
      createdAt: "2026-11-13T12:00:00Z", updatedAt: "2026-11-13T12:00:00Z", followups: []
    }) } } };
  }
  const fetchMock = vi.fn(async (input: string) => {
    const url = new URL(input);
    if (url.pathname.endsWith("user_feedback")) return Response.json({ documents: [] });
    if (url.searchParams.get("pageToken") === "next-page") return Response.json({ documents: [document(1000)] });
    return Response.json({ documents: Array.from({ length: 1000 }, (_, i) => document(i)), nextPageToken: "next-page" });
  });
  vi.stubGlobal("fetch", fetchMock);
  const stats = await getPublicStats();
  expect(stats.totalDebates).toBe(1001);
  expect(stats.completedDebates).toBe(501);
  expect(stats.statusBreakdown.find((item) => item.status === "failed")?.count).toBe(500);
  expect(fetchMock.mock.calls.some(([url]) => new URL(url).searchParams.get("pageToken") === "next-page")).toBe(true);
});
