import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Copy, Check, ExternalLink } from "lucide-react";
import { useState, useCallback, type ReactNode } from "react";
import { format } from "date-fns";
import { type Announcement, type AnnouncementSource, type AnnouncementStatus } from "@leadfinder/contracts";

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
        if (match.endsWith(":")) return `<span class="text-yellow-400">${match}</span>`;
        return `<span class="text-green-400">${match}</span>`;
      }
      if (match === "true" || match === "false") return `<span class="text-blue-400">${match}</span>`;
      if (match === "null") return `<span class="text-muted-foreground">${match}</span>`;
      return `<span class="text-violet-400">${match}</span>`;
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

function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
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
    void navigator.clipboard.writeText(JSON.stringify(announcement.rawData, null, 2)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [announcement]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[90vh] w-[min(94vw,900px)] max-w-none flex-col gap-0 p-0">
        {announcement && (
          <>
            <DialogHeader className="shrink-0 border-b px-6 py-4">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <Badge variant="secondary">{SOURCE_LABELS[announcement.sourceSystem]}</Badge>
                <Badge variant="outline">{STATUS_LABELS[announcement.status]}</Badge>
                <span className="text-xs text-muted-foreground">ID: {announcement.externalId}</span>
              </div>
              <DialogTitle className="line-clamp-2 text-base font-semibold">
                {announcement.title}
              </DialogTitle>
            </DialogHeader>

            <ScrollArea className="flex-1">
              <div className="px-6 py-4 space-y-6">
                {/* Key parameters */}
                <section>
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Kluczowe parametry
                  </p>
                  <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <MetaRow label="Źródło">{SOURCE_LABELS[announcement.sourceSystem]}</MetaRow>
                    <MetaRow label="Status">{STATUS_LABELS[announcement.status]}</MetaRow>
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
                          {announcement.valueMax && announcement.valueMax !== announcement.valueMin
                            ? ` – ${Number(announcement.valueMax).toLocaleString("pl-PL", {
                                style: "currency",
                                currency: "PLN",
                                maximumFractionDigits: 0,
                              })}`
                            : null}
                        </span>
                      ) : "—"}
                    </MetaRow>
                  </dl>

                  {announcement.description && (
                    <div className="mt-4">
                      <dt className="mb-1 text-xs font-medium text-muted-foreground">Opis</dt>
                      <p className="text-sm leading-relaxed text-foreground">{announcement.description}</p>
                    </div>
                  )}

                  <div className="mt-4">
                    <a
                      href={announcement.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 text-sm underline-offset-4 hover:underline text-primary"
                    >
                      <ExternalLink className="size-4" />
                      Otwórz ogłoszenie w serwisie źródłowym
                    </a>
                  </div>
                </section>

                <Separator />

                {/* Raw JSON */}
                <section>
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Dane surowe (JSON)
                    </p>
                    <Button variant="outline" size="xs" onClick={handleCopy}>
                      {copied ? (
                        <><Check className="size-3 text-green-500" /> Skopiowano</>
                      ) : (
                        <><Copy className="size-3" /> Kopiuj JSON</>
                      )}
                    </Button>
                  </div>
                  <div className="overflow-x-auto rounded-lg border bg-zinc-950 px-4 py-3">
                    <pre
                      className="text-xs leading-relaxed font-mono text-zinc-300"
                      dangerouslySetInnerHTML={{ __html: highlightJson(announcement.rawData) }}
                    />
                  </div>
                </section>
              </div>
            </ScrollArea>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

