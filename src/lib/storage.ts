import "server-only";
/**
 * File storage for uploads (attachments, floor plans). OWNED BY THE LEAD.
 *
 * Files live OUTSIDE public/ (UPLOAD_DIR, default ./storage/uploads) and are served by /files/[...path]
 * (src/app/files/[...path]/route.ts), which:
 *  - only serves allow-listed types, with the content type taken from that list (never sniffed),
 *  - sends everything except PDFs and raster images as a download,
 *  - adds nosniff and a sandboxing Content-Security-Policy, so an uploaded file can never run script as this app,
 *  - reads from disk per request, so new uploads are available immediately (public/ is frozen at `next start`).
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const UPLOAD_ROOT = path.resolve(process.env.UPLOAD_DIR ?? path.join(/* turbopackIgnore: true */ process.cwd(), "storage", "uploads"));

type FileKind = { mime: string; inline: boolean };
export const ALLOWED_FILES: Record<string, FileKind> = {
  ".pdf": { mime: "application/pdf", inline: true },
  ".png": { mime: "image/png", inline: true },
  ".jpg": { mime: "image/jpeg", inline: true },
  ".jpeg": { mime: "image/jpeg", inline: true },
  ".webp": { mime: "image/webp", inline: true },
  ".gif": { mime: "image/gif", inline: true },
  ".doc": { mime: "application/msword", inline: false },
  ".docx": { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", inline: false },
  ".xls": { mime: "application/vnd.ms-excel", inline: false },
  ".xlsx": { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", inline: false },
  ".ppt": { mime: "application/vnd.ms-powerpoint", inline: false },
  ".pptx": { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", inline: false },
  ".csv": { mime: "text/csv", inline: false },
  ".txt": { mime: "text/plain", inline: false },
  ".zip": { mime: "application/zip", inline: false },
  ".dwg": { mime: "application/acad", inline: false },
  ".dxf": { mime: "application/dxf", inline: false },
  ".msg": { mime: "application/vnd.ms-outlook", inline: false },
  ".eml": { mime: "message/rfc822", inline: false },
};

export const ALLOWED_EXTENSIONS_LABEL = "PDF, images (PNG, JPEG, WebP, GIF), Word, Excel, PowerPoint, CSV, text, ZIP, DWG/DXF or email files";

export function fileKind(name: string): FileKind | null {
  return ALLOWED_FILES[path.extname(name).toLowerCase()] ?? null;
}

/** Strip anything but word characters, dot, dash and space; keep the (lower-cased) extension. */
export function safeFileName(name: string): string {
  const ext = path.extname(name).toLowerCase();
  const base = path.basename(name, path.extname(name)).replace(/[^\w.\- ]+/g, "_").replace(/^\.+/, "").slice(0, 100) || "file";
  return base + ext;
}

/**
 * Store bytes under UPLOAD_ROOT/<folder>/ and return the public URL (/files/<folder>/<stored name>).
 * `folder` is built by our code (e.g. "offer/12", "plans"); it is still validated.
 */
export async function storeFile(folder: string, originalName: string, bytes: Uint8Array): Promise<string> {
  if (!/^[a-z]+(\/\d+)?$/.test(folder)) throw new Error("Invalid storage folder");
  if (!fileKind(originalName)) throw new Error(`Upload ${ALLOWED_EXTENSIONS_LABEL}.`);
  const dir = path.join(UPLOAD_ROOT, folder);
  await mkdir(dir, { recursive: true });
  const stored = `${Date.now()}-${safeFileName(originalName)}`;
  await writeFile(path.join(dir, stored), bytes);
  return `/files/${folder}/${encodeURIComponent(stored)}`;
}

/** Resolve a /files/... path segment list to an absolute path inside UPLOAD_ROOT, or null if it escapes. */
export function resolveStored(segments: string[]): string | null {
  if (segments.some((s) => s === "" || s === "." || s === ".." || s.includes("\0"))) return null;
  const abs = path.resolve(UPLOAD_ROOT, ...segments);
  return abs.startsWith(UPLOAD_ROOT + path.sep) ? abs : null;
}
