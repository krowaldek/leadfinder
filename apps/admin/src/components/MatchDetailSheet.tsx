import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { pl } from "date-fns/locale";
import { ExternalLink } from "lucide-react";
import type { ClientMatchResponse } from "@leadfinder/contracts";

function buildAnnouncementPanelHref(announcement: Pick<ClientMatchResponse["announcement"], "id" | "externalId" | "sourceSystem" | "partIndex">) {
  const params = new URLSearchParams({
    id: announcement.id,
    search: announcement.externalId,
    source: announcement.sourceSystem,
    partIndex: String(announcement.partIndex),
  });

  return `/announcements?${params.toString()}`;
}

// ── Stałe (tożsame z ClientMatchesPage) ─────────────────────────────────────

const KIND_LABELS: Record<string, string> = {
  DOSTAWA: "Dostawa",
  USLUGA: "Usługa",
  ROBOTY_BUDOWLANE: "Roboty budowlane",
  SZKOLENIE: "Szkolenie",
  USLUGA_IT: "Usługi IT",
  USLUGA_BADAWCZO_ROZWOJOWA: "Usługi B+R",
  DORADZTWO: "Doradztwo",
  INNE: "Inne",
};

const SOURCE_LABELS: Record<string, string> = {
  BAZA_KONKURENCYJNOSCI: "Baza Konkurencyjności",
  E_ZAMOWIENIA: "e-Zamówienia",
  PLATFORMA_ZAKUPOWA: "Platforma Zakupowa",
};

// ── Pomocnicze ───────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-x-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="break-words">{value ?? <span className="italic text-muted-foreground/60">—</span>}</span>
    </div>
  );
}

/** Parsuje searchContext w formacie "TYTUŁ: … | OPIS: … | KODY CPV: …" */
function parseSearchContext(ctx: string): { label: string; value: string }[] {
  return ctx
    .split(" | ")
    .map((part) => {
      const colonIdx = part.indexOf(": ");
      if (colonIdx === -1) return { label: "?", value: part };
      return { label: part.slice(0, colonIdx), value: part.slice(colonIdx + 2) };
    });
}

/** Wizualizacja similarity: pasek + opis procentowy + wyjaśnienie skali */
function SimilarityBar({ similarity }: { similarity: number }) {
  const pct = Math.round(similarity * 100);
  const color =
    pct >= 75 ? "bg-green-500" :
    pct >= 60 ? "bg-emerald-400" :
    pct >= 45 ? "bg-yellow-500" :
    "bg-muted-foreground/40";

  const label =
    pct >= 75 ? "Bardzo wysokie dopasowanie" :
    pct >= 60 ? "Wysokie dopasowanie" :
    pct >= 45 ? "Umiarkowane dopasowanie" :
    "Słabe dopasowanie";

  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-3">
        <div className="h-3 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className={cn("h-full rounded-full transition-all", color)}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="w-12 text-right font-mono text-sm font-semibold">{pct}%</span>
      </div>
      <p className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{label}</span>
        {" — "}cosine similarity między wektorem ogłoszenia a wektorem profilu klienta.
        Im wyższy wynik, tym bliżej semantycznie były teksty podczas embeddingu.
      </p>
      <p className="text-xs text-muted-foreground">
        Skala orientacyjna:
        <span className="ml-1 font-medium text-green-600 dark:text-green-400">75%+</span> bardzo wysokie ·{" "}
        <span className="font-medium text-yellow-600 dark:text-yellow-400">60–74%</span> wysokie ·{" "}
        <span className="font-medium">45–59%</span> umiarkowane ·{" "}
        <span className="font-medium text-muted-foreground">poniżej 45%</span> słabe
      </p>
    </div>
  );
}

// ── Główny komponent ─────────────────────────────────────────────────────────

interface Props {
  match: ClientMatchResponse | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MatchDetailSheet({ match, open, onOpenChange }: Props) {
  if (!match) return null;

  const ann = match.announcement;
  const topic = match.topic;
  const parsedCtx = ann.searchContext ? parseSearchContext(ann.searchContext) : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-xl">
        <SheetHeader className="px-6 pb-4 pt-6">
          <SheetTitle className="text-base leading-snug">{ann.title}</SheetTitle>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {ann.kind && (
              <Badge variant="outline" className="text-xs">{KIND_LABELS[ann.kind] ?? ann.kind}</Badge>
            )}
            <Badge variant="secondary" className="text-xs">
              {SOURCE_LABELS[ann.sourceSystem] ?? ann.sourceSystem}
            </Badge>
            <Badge variant="secondary" className="font-mono text-xs">#{ann.externalId}</Badge>
            <a
              href={buildAnnouncementPanelHref(ann)}
              className="flex items-center gap-1 text-xs text-primary hover:underline"
            >
              W panelu ogłoszeń
            </a>
            <a
              href={ann.url}
              target="_blank"
              rel="noreferrer"
              className="ml-auto flex items-center gap-1 text-xs text-primary hover:underline"
            >
              Otwórz <ExternalLink className="size-3" />
            </a>
          </div>
        </SheetHeader>

        <Separator />

        <div className="grid gap-6 px-6 py-5">

          {/* Temat dopasowania */}
          <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Temat dopasowania</p>
            <p className="mt-0.5 text-sm font-medium">{topic.title}</p>
            <p className="text-xs text-muted-foreground">{topic.projectName}</p>
          </div>

          {/* Wartość LLM */}
          {ann.llmEstimatedValue && (
            <>
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                <p className="text-xs text-muted-foreground">
                  Wartość szacunkowa (LLM):{" "}
                  <span className="font-semibold text-foreground">
                    {Number(ann.llmEstimatedValue).toLocaleString("pl-PL", {
                      style: "currency",
                      currency: "PLN",
                      maximumFractionDigits: 0,
                    })}
                  </span>
                </p>
              </div>
              <Separator />
            </>
          )}

          {/* Wynik dopasowania */}
          <Section title="Dlaczego to dopasowanie?">
            <SimilarityBar similarity={match.similarity} />
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-muted-foreground">
              Dopasowanie jest liczone na podstawie embeddingu ogłoszenia i profilu klienta. Jeśli raport ogłoszenia
              jest pusty, system mógł dopasować pozycję na bazie `searchContext` i pozostałych danych użytych do
              wektoryzacji.
            </div>
          </Section>

          <Separator />

          {/* Co było embeddowane — searchContext */}
          {parsedCtx && (
            <>
              <Section title="Dane ogłoszenia użyte do embeddingu">
                <p className="mb-1 text-xs text-muted-foreground">
                  To jest zachowany kontekst źródłowy pozycji. W nowym pipeline embedding powstaje z rodzaju,
                  podsumowania, raportu pozycji i tego bazowego kontekstu.
                </p>
                <div className="grid gap-2 rounded-lg border bg-muted/40 p-3">
                  {parsedCtx.map(({ label, value }) => (
                    <div key={label}>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
                      <p className="mt-0.5 text-sm leading-relaxed">{value}</p>
                    </div>
                  ))}
                </div>
              </Section>
              <Separator />
            </>
          )}

          {ann.detailedReport ? (
            <>
              <Section title="Raport ogłoszenia (użyty do embeddingu)">
                <p className="mb-1 text-xs text-muted-foreground">
                  Ten raport jest głównym wejściem do wektoryzacji ogłoszenia.
                </p>
                <div className="rounded-lg border bg-muted/40 p-3">
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
                    {ann.detailedReport}
                  </p>
                </div>
              </Section>
              <Separator />
            </>
          ) : (
            <>
              <Section title="Raport ogłoszenia (użyty do embeddingu)">
                <div className="grid gap-2 rounded-lg border border-dashed bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">
                    Brak raportu dla tego ogłoszenia.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    To nie blokuje dopasowania — wynik mógł zostać wyliczony na podstawie `searchContext`, typu
                    ogłoszenia i innych danych użytych do embeddingu.
                  </p>
                </div>
              </Section>
              <Separator />
            </>
          )}

          {/* Szczegóły ogłoszenia */}
          <Section title="Szczegóły ogłoszenia">
            <div className="grid gap-1.5">
              {ann.publishedAt && (
                <Field
                  label="Opublikowano"
                  value={format(new Date(ann.publishedAt), "dd.MM.yyyy HH:mm", { locale: pl })}
                />
              )}
              {ann.deadlineAt && (
                <Field
                  label="Termin składania"
                  value={format(new Date(ann.deadlineAt), "dd.MM.yyyy HH:mm", { locale: pl })}
                />
              )}
              {(ann.valueMin || ann.valueMax) && (
                <Field
                  label="Wartość szac."
                  value={
                    ann.valueMin && ann.valueMax
                      ? `${Number(ann.valueMin).toLocaleString("pl-PL")} – ${Number(ann.valueMax).toLocaleString("pl-PL")} PLN`
                      : ann.valueMin
                        ? `od ${Number(ann.valueMin).toLocaleString("pl-PL")} PLN`
                        : `do ${Number(ann.valueMax!).toLocaleString("pl-PL")} PLN`
                  }
                />
              )}
              {ann.llmEstimatedValue && (
                <Field
                  label="Wartość (LLM)"
                  value={
                    <span className="font-semibold">
                      {Number(ann.llmEstimatedValue).toLocaleString("pl-PL", {
                        style: "currency",
                        currency: "PLN",
                        maximumFractionDigits: 0,
                      })}
                    </span>
                  }
                />
              )}
              <Field label="Dopasowanie dodano" value={format(new Date(match.createdAt), "dd.MM.yyyy HH:mm", { locale: pl })} />
            </div>
          </Section>

          {/* Pełny opis */}
          {ann.description && (
            <>
              <Separator />
              <Section title="Pełny opis ogłoszenia">
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
                  {ann.description}
                </p>
              </Section>
            </>
          )}

        </div>
      </SheetContent>
    </Sheet>
  );
}
