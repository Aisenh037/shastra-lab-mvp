// Client side of OCR: one request per page so long PDFs never hit the edge
// function time limit, with progress, retries on transient errors, and a clear
// error when the user's daily page quota runs out.
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type OcrErrorCode = "OCR_QUOTA" | "IMAGE_TOO_LARGE" | "OCR_FAILED" | "UNAUTHORIZED" | "UNKNOWN";

export class OcrError extends Error {
  constructor(
    message: string,
    public code: OcrErrorCode,
    public status?: number,
  ) {
    super(message);
  }
}

/** Longest side, in pixels, of an image sent for reading. Plenty for handwriting. */
export const MAX_DIMENSION = 2000;
const RETRIES = 2;

type Invoke = (fn: string, body: unknown) => Promise<{ data: any; error: any }>;
const defaultInvoke: Invoke = (fn, body) => supabase.functions.invoke(fn, { body });

async function toOcrError(error: unknown): Promise<OcrError> {
  if (error instanceof FunctionsHttpError) {
    const res = error.context as Response;
    let body: { error?: string; code?: string } = {};
    try {
      body = await res.clone().json();
    } catch {
      /* not JSON */
    }
    const code = (body.code as OcrErrorCode) ?? (res.status === 401 ? "UNAUTHORIZED" : "UNKNOWN");
    return new OcrError(body.error ?? "Could not read the page.", code, res.status);
  }
  return new OcrError(error instanceof Error ? error.message : "Could not read the page.", "UNKNOWN");
}

const retryable = (e: OcrError) => e.code === "OCR_FAILED" || e.code === "UNKNOWN" || (e.status ?? 0) >= 500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call(fn: string, body: unknown, invoke: Invoke): Promise<any> {
  let last: OcrError | null = null;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    const { data, error } = await invoke(fn, body);
    if (!error) return data;
    last = await toOcrError(error);
    if (!retryable(last) || attempt === RETRIES) break;
    await sleep(1000 * (attempt + 1));
  }
  throw last!;
}

/** Read one photo of a handwritten answer. */
export async function readHandwriting(imageData: string, invoke: Invoke = defaultInvoke): Promise<string> {
  const data = await call("ocr-handwriting", { imageData }, invoke);
  return String(data?.text ?? "");
}

export interface PdfProgress {
  done: number;
  total: number;
}

/**
 * Read scanned PDF pages one request at a time. If the quota runs out midway,
 * throws OcrError(OCR_QUOTA) with `partial` holding the pages already read.
 */
export async function readScannedPages(
  images: string[],
  onProgress?: (p: PdfProgress) => void,
  invoke: Invoke = defaultInvoke,
): Promise<string> {
  const pages: string[] = [];
  onProgress?.({ done: 0, total: images.length });
  for (const image of images) {
    try {
      const data = await call("ocr-pdf", { images: [image] }, invoke);
      pages.push(String(data?.text ?? ""));
    } catch (e) {
      if (e instanceof OcrError && e.code === "OCR_QUOTA") {
        Object.assign(e, { partial: pages.join("\n\n") });
        throw e;
      }
      if (e instanceof OcrError && e.code === "UNAUTHORIZED") throw e;
      pages.push("[Could not read this page]");
    }
    onProgress?.({ done: pages.length, total: images.length });
  }
  return pages.join("\n\n");
}

/** Shrink a data-URL image so its longest side is at most MAX_DIMENSION (JPEG). */
export async function downscaleImage(dataUrl: string, maxDim = MAX_DIMENSION, quality = 0.85): Promise<string> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("Could not load image"));
    el.src = dataUrl;
  });
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  if (scale === 1 && dataUrl.length < 3_000_000) return dataUrl;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}
