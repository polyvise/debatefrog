import React, { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FroglingsWorkspace } from "@/components/froglings-workspace";
import { readDebateHistory, rememberDebate } from "@/lib/debate-history";

const controls = vi.hoisted(() => ({ push: vi.fn(), stop: vi.fn(), watch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: controls.push }) }));
vi.mock("@/lib/watch-debate", () => ({ watchDebate: controls.watch }));
vi.mock("@/components/pond-theater", () => ({ PondScenery: () => null, LilyPad: () => null, PondTheater: ({ live }: { live: { subject: string } }) => createElement("p", null, `Debating: ${live.subject}`) }));
vi.mock("@/components/use-judge-entrance-croak", () => ({ useJudgeEntranceCroak: () => {} }));

const seed = { id: "debate_first", subject: "Should schools have longer recess?", status: "queued", createdAt: "2026-11-13T12:00:00Z", recovery: { available: true, attempt: 0 } };
let root: Root;
let host: HTMLDivElement;
let fetchMock: ReturnType<typeof vi.fn>;
function button(name: string) {
  const result = [...host.querySelectorAll("button")].find((node) => node.textContent?.trim() === name || node.getAttribute("aria-label") === name);
  if (!result) throw new Error(`Missing button: ${name}`);
  return result;
}
async function click(name: string) { await act(async () => button(name).click()); }
async function render() { await act(async () => root.render(createElement(FroglingsWorkspace))); }
async function start() {
  await click("Should schools have longer recess?");
  await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("React", React);
  localStorage.clear();
  localStorage.setItem("froglings:intro-seen", "1");
  controls.push.mockReset(); controls.stop.mockReset(); controls.watch.mockReset().mockReturnValue(controls.stop);
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  fetchMock = vi.fn(async (url: string) => url === "/api/model-options"
    ? Response.json({ defaults: {}, options: [] })
    : Response.json({ debate: seed }));
  vi.stubGlobal("fetch", fetchMock);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("protected workspace navigation", () => {
  it("uses the same confirmation for the logo and New question, keeping progress on cancel", async () => {
    await render(); await start();
    expect(readDebateHistory()[0].id).toBe(seed.id);
    await click("DebateFrog — new question");
    expect(host.querySelector("dialog")?.textContent).toContain("saved progress is in My debates");
    await click("No, stay here");
    expect(host.textContent).toContain(`Debating: ${seed.subject}`);
    expect(controls.stop).not.toHaveBeenCalled();
    await click("New question"); await click("Yes, new question");
    expect(host.querySelector("textarea")?.value).toBe("");
    expect(controls.stop).toHaveBeenCalledOnce();
    await click("My debates");
    await click(`${seed.subject}Nov 13, 2026 · Started · open to check`);
    expect(host.textContent).toContain(`Debating: ${seed.subject}`);
    expect(controls.watch).toHaveBeenCalledTimes(2);
  });
  it("requires confirmation before Pond stats and supports cancel", async () => {
    await render(); await start(); await click("Pond stats");
    expect(host.querySelector("dialog")?.textContent).toContain("Visit Pond stats?");
    expect(controls.push).not.toHaveBeenCalled();
    await click("No, stay here");
    expect(host.textContent).toContain(`Debating: ${seed.subject}`);
    await click("Pond stats"); await click("Yes, visit stats");
    expect(controls.push).toHaveBeenCalledWith("/stats");
  });
  it("warns about drafts, but allows empty-form navigation directly", async () => {
    await render(); await click("Pond stats");
    expect(controls.push).toHaveBeenCalledWith("/stats"); controls.push.mockClear();
    await click("Should schools have longer recess?"); await click("Pond stats");
    expect(host.querySelector("dialog")?.textContent).toContain("lose that draft");
    await click("No, stay here");
    expect(host.querySelector("textarea")?.value).toBe(seed.subject);
  });
  it("shows an honest warning when browser storage fails", async () => {
    await render();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    await start(); await click("New question");
    expect(host.querySelector("dialog")?.textContent).toContain("couldn’t save this debate");
  });
  it("blocks starting a debate during history loading and safely cancels the lookup", async () => {
    rememberDebate({ ...seed, status: "complete" });
    await render(); await click("My debates");
    let finish!: (response: Response) => void;
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => { finish = resolve; }));
    await click(`${seed.subject}Nov 13, 2026 · Finished`);
    expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
    await click("Close my debates");
    await act(async () => finish(Response.json({ debate: seed })));
    expect(host.querySelector("textarea")).not.toBeNull();
    expect(controls.watch).not.toHaveBeenCalled();
  });
  it("keeps the current debate when opening history fails", async () => {
    rememberDebate({ ...seed, id: "debate_missing", subject: "Another question?", status: "failed" });
    await render(); await start(); await click("My debates");
    await click("Another question?Nov 13, 2026 · Needs another try");
    fetchMock.mockImplementation(async () => Response.json({}, { status: 404 }));
    await click("Yes, open debate");
    expect(host.textContent).toContain("We couldn’t find that debate");
    expect(host.textContent).toContain(`Debating: ${seed.subject}`);
    expect(controls.stop).not.toHaveBeenCalled();
  });
});
