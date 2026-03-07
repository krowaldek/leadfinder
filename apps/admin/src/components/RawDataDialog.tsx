import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "framer-motion";
import { Copy, Check, ExternalLink, X } from "lucide-react";
import { useState, useCallback, type ReactNode } from "react";
import { format } from "date-fns";
import { type Announcement, type AnnouncementSource, type AnnouncementStatus } from "@leadfinder/contracts";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// JSON syntax highlighter
// ---------------------------------------------------------------------------

function highlightJson(data: unknown): string {
  const json = JSON.stringify(data, null, 2);
  const escaped = json.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return escaped.replace(
    /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(?:\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    (match) => {
      if (match.startsWith('"')) {
        if (match.endsWith(":")) {
          return `<span class="text-amber-500 dark:text-amber-300">${match}</span>`;
        }
        return `<span class="text-emerald-600 dark:text-emerald-400">${match}</span>`;
      }
      if (match === "true" || match === "false") {
        return `<span class="text-blue-500 dark:text-blue-400">${match}</span>`;
      }
      if (match === "null") {
        return `<span class="text-stone-400">${match}</span>`;
      }
      return `<span class="text-violet-600 dark:text-violet-400">${match}</span>`;
    },
  );
}

// ---------------------------------------------------------------------------
// Label helpers
// ---------------------------------------------------------------------------

export const SOURCE_LABELS: Record<AnnouncementSource, string> = {
  BAZA_KONKURENCYJNOSCI: "Baza Konkurencyjności",
  E_ZAMOWIENIA: "e-Zamówienia",
  PLATFORMA_ZAKUPOWA: "Platforma Zakupowa",
};

export const STATUS_LABELS: Record<AnnouncementStatus, string> = {
  OPEN: "Aktywne",
  CLOSED: "Zakończone",
  AWARDED: "Rozstrzygnięte",
  UNKNOWN: "Nieznany",
};

const STATUS_BADGE_CLASS: Record<AnnouncementStatus, string> = {
  OPEN: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-300",
  CLOSED: "bg-stone-100 text-stone-700 dark:bg-stone-700 dark:text-stone-300",
  AWARDED: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-300",
  UNKNOWN: "bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400",
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Badge({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-3 py-1 text-xs uppercase tracking-[0.18em]",
        className,
      )}
    >
      {children}
    </span>
  );
}

function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs uppercase tracking-[0.25em] text-stone-400">{label}</dt>
      <dd className="text-sm text-stone-800 dark:text-stone-200">{children}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface RawDataDialogProps {
  announcement: Announcement | null;
  open: boolean;
  onClose: () => void;
}

export function RawDataDialog({ announcement, open, onClose }: RawDataDialogProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    if (!announcement) return;
    void navigator.clipboard
      .writeText(JSON.stringify(announcement.rawData, null, 2))
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
  }, [announcement]);

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <AnimatePresence>
        {open && announcement && (
          <Dialog.Portal forceMount>
            {/* Backdrop */}
            <Dialog.Overlay asChild>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="fixed inset-0 z-40 bg-stone-950/60 backdrop-blur-sm"
              />
            </Dialog.Overlay>

            {/* Panel */}
            <Dialog.Content asChild aria-describedby={undefined}>
              <motion.div
                initial={{ opacity: 0, scale: 0.97, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97, y: 12 }}
                transition={{ duration: 0.25, ease: "easeOut" }}
                className="fixed inset-4 z-50 flex flex-col overflow-hidden rounded-[2rem] border border-white/60 bg-white shadow-[0_30px_90px_rgba(117,84,36,0.18)] dark:border-stone-700/60 dark:bg-stone-900 md:inset-6 lg:inset-[5vw]"
              >
                {/* Header */}
                <div className="flex shrink-0 items-start justify-between gap-4 border-b border-stone-900/10 px-6 py-5 dark:border-stone-700/60">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className="bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300">
                        {SOURCE_LABELS[announcement.sourceSystem]}
                      </Badge>
                      <Badge className={STATUS_BADGE_CLASS[announcement.status]}>
                        {STATUS_LABELS[announcement.status]}
                      </Badge>
                      <span className="text-xs text-stone-400">
                        ID: {announcement.externalId}
                      </span>
                    </div>
                    <Dialog.Title className="mt-2 line-clamp-2 font-[Cormorant_Garamond] text-2xl font-semibold text-stone-950 dark:text-stone-100">
                      {announcement.title}
                    </Dialog.Title>
                  </div>

                  <Dialog.Close asChild>
                    <button
                      type="button"
                      className="shrink-0 flex h-9 w-9 items-center justify-center rounded-full border border-stone-200 text-stone-400 transition hover:border-stone-400 hover:text-stone-700 dark:border-stone-700 dark:hover:border-stone-500 dark:hover:text-stone-300"
                      aria-label="Zamknij"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </Dialog.Close>
                </div>

                {/* Scrollable body */}
                <div className="flex-1 overflow-y-auto">
                  {/* Key parameters */}
                  <section className="border-b border-stone-100 px-6 py-5 dark:border-stone-700/60">
                    <p className="mb-4 text-xs uppercase tracking-[0.35em] text-stone-500 dark:text-stone-400">
                      Kluczowe parametry
                    </p>
                    <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      <MetaRow label="Źródło">
                        {SOURCE_LABELS[announcement.sourceSystem]}
                      </MetaRow>
                      <MetaRow label="Status">
                        {STATUS_LABELS[announcement.status]}
                      </MetaRow>
                      <MetaRow label="Termin składania ofert">
                        {announcement.deadlineAt
                          ? format(new Date(announcement.deadlineAt), "dd.MM.yyyy HH:mm")
                          : "—"}
                      </MetaRow>
                      <MetaRow label="Data publikacji">
                        {announcement.publishedAt
                          ? format(new Date(announcement.publishedAt), "dd.MM.yyyy")
                          : "—"}
                      </MetaRow>
                      <MetaRow label="Data dodania">
                        {format(new Date(announcement.createdAt), "dd.MM.yyyy HH:mm")}
                      </MetaRow>
                      <MetaRow label="Szacowana wartość">
                        {announcement.valueMin || announcement.valueMax ? (
                          <span>
                            {announcement.valueMin
                              ? Number(announcement.valueMin).toLocaleString("pl-PL", {
                                  style: "currency",
                                  currency: "PLN",
                                  maximumFractionDigits: 0,
                                })
                              : "?"}
                            {announcement.valueMax &&
                            announcement.valueMax !== announcement.valueMin ? (
                              <>
                                {" – "}
                                {Number(announcement.valueMax).toLocaleString("pl-PL", {
                                  style: "currency",
                                  currency: "PLN",
                                  maximumFractionDigits: 0,
                                })}
                              </>
                            ) : null}
                          </span>
                        ) : (
                          "—"
                        )}
                      </MetaRow>
                    </dl>

                    {announcement.description && (
                      <div className="mt-4">
                        <dt className="mb-1 text-xs uppercase tracking-[0.25em] text-stone-400">
                          Opis
                        </dt>
                        <p className="text-sm leading-6 text-stone-700 dark:text-stone-300">
                          {announcement.description}
                        </p>
                      </div>
                    )}

                    <div className="mt-4">
                      <a
                        href={announcement.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 rounded-full border border-stone-200 px-4 py-2 text-xs text-stone-600 transition hover:border-amber-400 hover:text-amber-700 dark:border-stone-700 dark:text-stone-400 dark:hover:border-amber-500 dark:hover:text-amber-400"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        Otwórz ogłoszenie w serwisie źródłowym
                      </a>
                    </div>
                  </section>

                  {/* Raw JSON viewer */}
                  <section className="px-6 py-5">
                    <div className="mb-3 flex items-center justify-between">
                      <p className="text-xs uppercase tracking-[0.35em] text-stone-500 dark:text-stone-400">
                        Dane surowe (JSON)
                      </p>
                      <button
                        type="button"
                        onClick={handleCopy}
                        className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 px-3 py-1.5 text-xs text-stone-500 transition hover:border-stone-400 hover:text-stone-700 dark:border-stone-700 dark:text-stone-400 dark:hover:border-stone-500 dark:hover:text-stone-200"
                      >
                        {copied ? (
                          <>
                            <Check className="h-3.5 w-3.5 text-emerald-500" />
                            Skopiowano
                          </>
                        ) : (
                          <>
                            <Copy className="h-3.5 w-3.5" />
                            Kopiuj JSON
                          </>
                        )}
                      </button>
                    </div>

                    <div className="overflow-x-auto rounded-2xl border border-stone-100 bg-stone-950 px-5 py-4 dark:border-stone-700/60">
                      <pre
                        className="text-xs leading-relaxed font-mono text-stone-300"
                        dangerouslySetInnerHTML={{
                          __html: highlightJson(announcement.rawData),
                        }}
                      />
                    </div>
                  </section>
                </div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
