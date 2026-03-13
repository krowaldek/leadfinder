import { Logger } from "@nestjs/common";
import type { AnnouncementSource, AttachmentCacheStatus } from "@prisma/client";
import axios from "axios";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParseModule = require("pdf-parse") as {
  PDFParse?: new (input: {
    data: Buffer | Uint8Array;
    verbosity?: number;
  }) => {
    getText(params?: Record<string, unknown>): Promise<{
      text: string;
      total?: number;
      pages?: Array<{ num: number; text: string }>;
    }>;
    destroy(): Promise<void>;
  };
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mammoth = require("mammoth") as {
  extractRawText(input: { buffer: Buffer }): Promise<{ value: string }>;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfjs = require("pdfjs-dist/legacy/build/pdf.mjs") as {
  getDocument(options: { data: Uint8Array; disableWorker?: boolean; isEvalSupported?: boolean; useSystemFonts?: boolean }): {
    promise: Promise<{
      numPages: number;
      getPage(pageNumber: number): Promise<{
        getViewport(options: { scale: number }): { width: number; height: number };
        render(options: { canvasContext: unknown; viewport: { width: number; height: number } }): { promise: Promise<void> };
      }>;
    }>;
  };
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const canvas = require("@napi-rs/canvas") as {
  createCanvas(width: number, height: number): {
    getContext(type: "2d"): unknown;
    toBuffer(format: "image/png"): Buffer;
  };
  DOMMatrix: unknown;
  ImageData: unknown;
  Path2D: unknown;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const tesseract = require("tesseract.js") as {
  createWorker: (
    langs?: string,
    oem?: number,
    options?: { logger?: (message: unknown) => void },
  ) => Promise<{
    recognize(image: Buffer): Promise<{ data: { text: string } }>;
    terminate(): Promise<void>;
  }>;
  OEM: { LSTM_ONLY: number };
};

if (!(globalThis as Record<string, unknown>).DOMMatrix) {
  (globalThis as Record<string, unknown>).DOMMatrix = canvas.DOMMatrix;
}
if (!(globalThis as Record<string, unknown>).ImageData) {
  (globalThis as Record<string, unknown>).ImageData = canvas.ImageData;
}
if (!(globalThis as Record<string, unknown>).Path2D) {
  (globalThis as Record<string, unknown>).Path2D = canvas.Path2D;
}

async function pdfParse(
  buffer: Buffer,
  options?: Record<string, unknown>,
): Promise<{ text: string; numpages: number }> {
  const PdfParser = pdfParseModule.PDFParse;
  if (!PdfParser) {
    throw new Error("pdf-parse does not expose PDFParse constructor");
  }

  const parser = new PdfParser({
    data: buffer,
  });

  try {
    const parsed = await parser.getText(options);
    return {
      text: typeof parsed.text === "string" ? parsed.text : "",
      numpages:
        typeof parsed.total === "number"
          ? parsed.total
          : Array.isArray(parsed.pages)
            ? parsed.pages.length
            : 0,
    };
  } finally {
    await parser.destroy();
  }
}

const SUPPORTED_EXTENSIONS = new Set([
  "pdf",
  "docx",
  "txt",
  "md",
  "csv",
  "json",
  "xml",
  "html",
  "htm",
]);

const HIGH_VALUE_KEYWORDS: Array<[RegExp, number]> = [
  [/(specyfik|swz|siwz|opz|przedmiot|zakres|wymagan|warunk)/i, 120],
  [/(formularz.*cen|kosztorys|wycen|cenow|price|warto)/i, 90],
  [/(umow|projekt umowy|wz[oó]r umowy|ipu)/i, 80],
  [/(ofert|za[lł][aą]cznik|zalacznik|opis)/i, 50],
  [/(harmonogram|termin|kryteri)/i, 40],
  [/(rodo|informacyjn|klauzul)/i, -25],
  [/(jpg|jpeg|png|gif|zip|7z|rar)/i, -200],
];

const EXTENSION_BASE_SCORE: Record<string, number> = {
  pdf: 40,
  docx: 35,
  txt: 30,
  md: 30,
  html: 25,
  htm: 25,
  xml: 20,
  json: 15,
  csv: 10,
};

const OCR_LANGS = "pol+eng";
const OCR_MAX_PAGES = 8;
const OCR_RENDER_SCALE = 1.5;

export interface RawAttachmentLike {
  name?: string;
  type?: string;
  url?: string;
  file?: {
    uri?: string;
    name?: string;
  };
}

export interface RankedAttachment {
  name: string;
  url: string;
  ext: string;
  score: number;
  cacheKey: string;
  sourceSystem?: AnnouncementSource;
  contentType?: string;
}

export interface DirectPdfEmbeddingAttachment {
  name: string;
  buffer: Buffer;
  pageCount: number;
}

export interface AttachmentExtractionOptions {
  maxAttachments: number;
  maxCharsPerFile: number;
  maxTotalChars: number;
  timeoutMs?: number;
}

export interface AttachmentCacheEntry {
  cacheKey: string;
  extractedText: string | null;
  extractionMethod: string | null;
  status: AttachmentCacheStatus;
  failureReason: string | null;
}

export interface AttachmentCacheAdapter {
  get(cacheKey: string): Promise<AttachmentCacheEntry | null>;
  set(input: {
    cacheKey: string;
    sourceSystem?: AnnouncementSource;
    attachmentUrl: string;
    attachmentName: string;
    fileExt?: string;
    contentType?: string;
    extractedText: string | null;
    extractionMethod: string | null;
    status: AttachmentCacheStatus;
    failureReason: string | null;
  }): Promise<void>;
}

export function normalizeAndRankAttachments(
  attachments: RawAttachmentLike[],
  options: {
    bkApiBaseUrl?: string;
    sourceSystem?: AnnouncementSource;
    maxAttachments: number;
  },
): RankedAttachment[] {
  const normalized = attachments
    .map((attachment) =>
      normalizeAttachment(attachment, options.bkApiBaseUrl, options.sourceSystem),
    )
    .filter((attachment): attachment is RankedAttachment => attachment !== null)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "pl"));

  return normalized.slice(0, options.maxAttachments);
}

export async function extractAttachmentTexts(
  attachments: RankedAttachment[],
  options: AttachmentExtractionOptions,
  logger: Logger,
  cache?: AttachmentCacheAdapter,
): Promise<string[]> {
  const extractedTexts: string[] = [];
  let totalChars = 0;

  for (const attachment of attachments) {
    if (totalChars >= options.maxTotalChars) break;

    try {
      const remainingChars = options.maxTotalChars - totalChars;
      const text = await getAttachmentText(
        attachment,
        {
          timeoutMs: options.timeoutMs ?? 30_000,
          maxChars: Math.min(options.maxCharsPerFile, remainingChars),
        },
        logger,
        cache,
      );

      if (!text) continue;

      extractedTexts.push(`[${attachment.name}]\n${text}`);
      totalChars += text.length;
      logger.debug(
        `Parsed attachment: ${attachment.name} (${text.length} chars, score=${attachment.score})`,
      );
    } catch (error) {
      logger.warn(
        `Attachment parse failed (${attachment.name}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return extractedTexts;
}

export async function fetchDirectPdfEmbeddingAttachments(
  attachments: RankedAttachment[],
  options: {
    maxAttachments: number;
    maxPages: number;
    timeoutMs?: number;
  },
  logger: Logger,
): Promise<DirectPdfEmbeddingAttachment[]> {
  const pdfAttachments = attachments.filter((attachment) => attachment.ext === "pdf");
  const directAttachments: DirectPdfEmbeddingAttachment[] = [];

  for (const attachment of pdfAttachments) {
    if (directAttachments.length >= options.maxAttachments) break;

    try {
      const response = await axios.get<ArrayBuffer>(attachment.url, {
        responseType: "arraybuffer",
        timeout: options.timeoutMs ?? 30_000,
        maxContentLength: 20 * 1024 * 1024,
      });

      const buffer = Buffer.from(response.data);
      const parsed = await pdfParse(buffer);
      const pageCount = parsed.numpages ?? 0;

      if (pageCount === 0 || pageCount > options.maxPages) {
        logger.debug(
          `Skipping direct PDF embedding for ${attachment.name} (pages=${pageCount}, max=${options.maxPages})`,
        );
        continue;
      }

      directAttachments.push({
        name: attachment.name,
        buffer,
        pageCount,
      });
    } catch (error) {
      logger.warn(
        `Direct PDF embedding fetch failed (${attachment.name}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return directAttachments;
}

function normalizeAttachment(
  attachment: RawAttachmentLike,
  bkApiBaseUrl?: string,
  sourceSystem?: AnnouncementSource,
): RankedAttachment | null {
  const fileName = String(attachment.file?.name ?? "").trim();
  const name = String(attachment.name ?? fileName ?? "").trim();
  const url = resolveAttachmentUrl(attachment, bkApiBaseUrl);

  if (!name || !url) return null;

  const ext = getExtension(fileName || name || url, attachment.type);
  if (!ext || !SUPPORTED_EXTENSIONS.has(ext)) return null;

  const score = scoreAttachment([name, fileName].filter(Boolean).join(" "), ext);
  const identity = attachment.file?.uri?.trim() || stripQueryString(url);
  return {
    name,
    url,
    ext,
    score,
    sourceSystem,
    contentType: attachment.type,
    cacheKey: `${sourceSystem ?? "UNKNOWN"}:${identity}`,
  };
}

function resolveAttachmentUrl(
  attachment: RawAttachmentLike,
  bkApiBaseUrl?: string,
): string | null {
  if (typeof attachment.url === "string" && attachment.url.trim()) {
    return attachment.url;
  }

  const fileUri = attachment.file?.uri?.trim();
  if (fileUri && bkApiBaseUrl) {
    return buildBkFileUrl(bkApiBaseUrl, fileUri);
  }

  return null;
}

function buildBkFileUrl(apiBaseUrl: string, fileUri: string): string {
  const base = apiBaseUrl.endsWith("/api")
    ? apiBaseUrl.slice(0, -4)
    : apiBaseUrl.replace(/\/$/, "");
  return `${base}${fileUri}`;
}

function stripQueryString(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url.split("?")[0] ?? url;
  }
}

function getExtension(name: string, type?: string): string | null {
  const normalizedName = name.toLowerCase();
  const lastDot = normalizedName.lastIndexOf(".");
  if (lastDot !== -1 && lastDot < normalizedName.length - 1) {
    return normalizedName.slice(lastDot + 1);
  }

  if (type?.toLowerCase() === "pdf") return "pdf";
  return null;
}

function scoreAttachment(name: string, ext: string): number {
  let score = EXTENSION_BASE_SCORE[ext] ?? 0;

  for (const [pattern, bonus] of HIGH_VALUE_KEYWORDS) {
    if (pattern.test(name)) score += bonus;
  }

  if (/część|part|zalacznik nr|załącznik nr/i.test(name)) score += 10;
  if (/skan|scan/i.test(name)) score -= 20;

  return score;
}

async function getAttachmentText(
  attachment: RankedAttachment,
  options: { timeoutMs: number; maxChars: number },
  logger: Logger,
  cache?: AttachmentCacheAdapter,
): Promise<string | null> {
  const cached = cache ? await cache.get(attachment.cacheKey) : null;

  if (cached) {
    if (cached.status === "SUCCESS" && cached.extractedText) {
      logger.debug(`Attachment cache hit: ${attachment.name} (${cached.extractionMethod ?? "unknown"})`);
      return cached.extractedText.slice(0, options.maxChars);
    }
    if (cached.status === "UNSUPPORTED") {
      logger.debug(`Attachment cache skip unsupported: ${attachment.name}`);
      return null;
    }
  }

  const response = await axios.get<ArrayBuffer>(attachment.url, {
    responseType: "arraybuffer",
    timeout: options.timeoutMs,
    maxContentLength: 20 * 1024 * 1024,
  });

  const buffer = Buffer.from(response.data);
  const extracted = await extractTextFromBuffer(buffer, attachment.ext, logger);
  const normalizedText = extracted.text
    ? normalizeText(extracted.text).slice(0, options.maxChars)
    : null;

  if (cache) {
    await cache.set({
      cacheKey: attachment.cacheKey,
      sourceSystem: attachment.sourceSystem,
      attachmentUrl: attachment.url,
      attachmentName: attachment.name,
      fileExt: attachment.ext,
      contentType: attachment.contentType,
      extractedText: normalizedText,
      extractionMethod: extracted.method,
      status: normalizedText ? "SUCCESS" : extracted.status,
      failureReason: normalizedText ? null : extracted.failureReason,
    });
  }

  return normalizedText;
}

async function extractTextFromBuffer(
  buffer: Buffer,
  ext: string,
  logger: Logger,
): Promise<{
  text: string | null;
  method: string | null;
  status: AttachmentCacheStatus;
  failureReason: string | null;
}> {
  switch (ext) {
    case "pdf": {
      const parsed = await pdfParse(buffer);
      const directText = normalizeText(parsed.text ?? "");
      if (directText) {
        return { text: directText, method: "pdf-text", status: "SUCCESS", failureReason: null };
      }

      logger.debug("PDF has no extractable text — falling back to OCR");
      const ocrText = await extractPdfTextWithOcr(buffer, logger);
      if (ocrText) {
        return { text: ocrText, method: "pdf-ocr", status: "SUCCESS", failureReason: null };
      }

      return {
        text: null,
        method: "pdf-ocr",
        status: "FAILED",
        failureReason: "No extractable text from PDF or OCR",
      };
    }
    case "docx": {
      const parsed = await mammoth.extractRawText({ buffer });
      return {
        text: parsed.value,
        method: "docx-text",
        status: "SUCCESS",
        failureReason: null,
      };
    }
    case "txt":
    case "md":
    case "csv":
    case "json":
    case "xml":
      return {
        text: buffer.toString("utf8"),
        method: `${ext}-text`,
        status: "SUCCESS",
        failureReason: null,
      };
    case "html":
    case "htm":
      return {
        text: buffer
          .toString("utf8")
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<[^>]+>/g, " "),
        method: "html-text",
        status: "SUCCESS",
        failureReason: null,
      };
    default:
      return {
        text: null,
        method: null,
        status: "UNSUPPORTED",
        failureReason: `Unsupported extension: ${ext}`,
      };
  }
}

async function extractPdfTextWithOcr(
  buffer: Buffer,
  logger: Logger,
): Promise<string | null> {
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: true,
  });
  const pdf = await loadingTask.promise;
  const maxPages = Math.min(pdf.numPages, OCR_MAX_PAGES);
  let worker: Awaited<ReturnType<typeof tesseract.createWorker>> | null = null;

  try {
    worker = await tesseract.createWorker(OCR_LANGS, tesseract.OEM.LSTM_ONLY, {
      logger: () => {},
    });

    const pageTexts: string[] = [];
    for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: OCR_RENDER_SCALE });
      const targetCanvas = canvas.createCanvas(
        Math.max(1, Math.round(viewport.width)),
        Math.max(1, Math.round(viewport.height)),
      );
      const context = targetCanvas.getContext("2d");
      await page.render({ canvasContext: context, viewport }).promise;

      const image = targetCanvas.toBuffer("image/png");
      const recognized = await worker.recognize(image);
      const text = normalizeText(recognized.data.text ?? "");
      if (text) pageTexts.push(`[OCR strona ${pageNumber}]\n${text}`);
    }

    return pageTexts.join("\n\n").trim() || null;
  } catch (error) {
    logger.warn(`OCR fallback failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  } finally {
    if (worker) {
      await worker.terminate();
    }
  }
}

function normalizeText(text: string): string {
  return text.replace(/\r/g, "\n").replace(/\s{3,}/g, "\n").replace(/[ \t]{2,}/g, " ").trim();
}
