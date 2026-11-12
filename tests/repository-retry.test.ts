import { afterEach, describe, expect, it, vi } from "vitest";
import type { DebateRecord } from "@polyvise/core/debate/types";
import { FirestoreDebateRepository, MemoryDebateRepository } from "@/server/repository";

const record = { id: "test", status: "failed", createdAt: "2026-11-12T00:00:00.000Z", updatedAt: "2026-11-12T00:00:00.001Z" } as DebateRecord;
const next = { ...record, status: "queued" as const, updatedAt: "2026-11-12T00:00:00.002Z" };
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("retry ownership", () => {
  it("atomically claims a saved attempt and rejects stale workers", async () => {
    const repo = new MemoryDebateRepository({ debates: new Map(), feedback: new Map() });
    await repo.save(record);
    expect(await Promise.all([repo.saveIfUnchanged(next, record.updatedAt), repo.saveIfUnchanged(next, record.updatedAt)]))
      .toEqual([true, false]);
    expect(await repo.saveIfUnchanged({ ...record, status: "complete" }, record.updatedAt)).toBe(false);
  });

  it.each([200, 400, 409, 412])("uses Firestore's update-time precondition and handles status %i", async (status) => {
    vi.stubEnv("GOOGLE_OAUTH_ACCESS_TOKEN", "test-token");
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      updateTime: "2026-11-12T00:00:00.001001Z", fields: { recordJson: { stringValue: JSON.stringify(record) } }
    }))).mockResolvedValueOnce(new Response(JSON.stringify(status === 200 ? {} : { error: { status: "FAILED_PRECONDITION" } }), { status }));
    vi.stubGlobal("fetch", fetch);
    const result = await new FirestoreDebateRepository("project").saveIfUnchanged(next, record.updatedAt);
    expect(result).toBe(status === 200);
    const url = new URL(fetch.mock.calls[1][0]);
    expect(url.searchParams.get("currentDocument.updateTime")).toBe("2026-11-12T00:00:00.001001Z");
  });
});
