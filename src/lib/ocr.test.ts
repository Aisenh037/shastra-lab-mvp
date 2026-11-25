import { describe, expect, it, vi } from "vitest";
import { FunctionsHttpError } from "@supabase/supabase-js";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: vi.fn() } } }));
import { OcrError, readHandwriting, readScannedPages } from "./ocr";

const httpError = (status: number, body: unknown) =>
  new FunctionsHttpError(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

describe("readScannedPages", () => {
  it("sends one page per request and reports progress", async () => {
    const invoke = vi.fn(async (_fn: string, body: any) => ({ data: { text: `T:${body.images[0]}` }, error: null }));
    const progress: number[] = [];
    const text = await readScannedPages(["a", "b", "c"], (p) => progress.push(p.done), invoke);
    expect(invoke).toHaveBeenCalledTimes(3);
    expect(invoke.mock.calls.every(([fn, b]: any) => fn === "ocr-pdf" && b.images.length === 1)).toBe(true);
    expect(text).toBe("T:a\n\nT:b\n\nT:c");
    expect(progress).toEqual([0, 1, 2, 3]);
  });

  it("stops at the daily quota and keeps the pages already read", async () => {
    let n = 0;
    const invoke = vi.fn(async () =>
      ++n <= 2 ? { data: { text: `p${n}` }, error: null } : { data: null, error: httpError(429, { code: "OCR_QUOTA", error: "limit" }) },
    );
    const err = await readScannedPages(["a", "b", "c", "d"], undefined, invoke).catch((e) => e);
    expect(err).toBeInstanceOf(OcrError);
    expect(err.code).toBe("OCR_QUOTA");
    expect(err.partial).toBe("p1\n\np2");
    expect(invoke).toHaveBeenCalledTimes(3);
  });

  it("retries a transient failure, then marks the page unreadable and moves on", async () => {
    vi.useFakeTimers();
    const invoke = vi.fn(async (_fn: string, body: any) =>
      body.images[0] === "bad" ? { data: null, error: httpError(502, { code: "OCR_FAILED" }) } : { data: { text: "ok" }, error: null },
    );
    const p = readScannedPages(["bad", "good"], undefined, invoke);
    await vi.runAllTimersAsync();
    expect(await p).toBe("[Could not read this page]\n\nok");
    expect(invoke).toHaveBeenCalledTimes(4); // 3 tries for "bad", 1 for "good"
    vi.useRealTimers();
  });
});

describe("readHandwriting", () => {
  it("does not retry a quota error", async () => {
    const invoke = vi.fn(async () => ({ data: null, error: httpError(429, { code: "OCR_QUOTA", error: "Daily limit" }) }));
    const err = await readHandwriting("img", invoke).catch((e) => e);
    expect(err.code).toBe("OCR_QUOTA");
    expect(err.message).toBe("Daily limit");
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
