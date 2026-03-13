import { Building2, CheckCircle2, FileText, Info, ThumbsDown, ThumbsUp, Link2, Sparkles, AlertCircle } from "lucide-react";
import { type ClientMatchResponse } from "@leadfinder/contracts";
import { format, differenceInDays, differenceInHours } from "date-fns";

import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import {
  buildAnnouncementPanelHref,
  formatMoney,
  getDeadlineMeta,
  KIND_LABELS,
  MATCH_STATUS_LABELS,
  parseSearchContext,
  SOURCE_LABELS,
} from "./match-meta";
import { MatchScoreRing } from "./MatchScoreRing";
import { parseReportToSections, ReportSegment } from "./report-utils";

interface FeaturedMatchCardProps {
  match: ClientMatchResponse;
  statusPending: boolean;
  onStatusChange: (status: ClientMatchResponse["status"]) => void;
  onOpenDetails: () => void;
  onOpenReport: () => void;
}

function extractFallbackFromReport(report: string | null | undefined): string | null {
  if (!report) return null;
  const lines = report.split('\n');
  for (const line of lines) {
    const l = line.toLowerCase();
    if ((l.includes('szacowan') || l.includes('łączn') || l.includes('razem') || l.includes('wartość') || l.includes('koszt') || l.includes('budżet')) && l.includes('pln')) {
      const totalMatch = line.match(/=\s*([0-9][\d\s,.]*)\s*pln/i);
      if (totalMatch && totalMatch[1]) {
        const numericStr = totalMatch[1].replace(/[\s,.]/g, "");
        if (!isNaN(Number(numericStr)) && Number(numericStr) > 0) {
          return numericStr;
        }
      }

      const beforePln = line.split(/pln/i)[0] ?? "";
      const numberMatches = [...beforePln.matchAll(/[0-9][\d\s,.]*/g)];
      const lastNumber = numberMatches.at(-1)?.[0];

      if (lastNumber) {
        const numericStr = lastNumber.replace(/[\s,.]/g, "");
        if (!isNaN(Number(numericStr)) && Number(numericStr) > 0) {
          return numericStr;
        }
      }
    }
  }
  return null;
}

export function FeaturedMatchCard({
  match,
  statusPending,
  onStatusChange,
  onOpenDetails,
  onOpenReport,
}: FeaturedMatchCardProps) {
  const deadlineMeta = getDeadlineMeta(match.announcement.deadlineAt);
  const searchContext = parseSearchContext(match.announcement.searchContext);
  const panelHref = buildAnnouncementPanelHref(match.announcement);
  const reportAvailable = Boolean(match.announcement.detailedReport?.trim());

  // Determine if it's "urgent" (e.g. deadline is soon and not expired)
  const isUrgent = deadlineMeta.urgent;

  const deadlineDate = match.announcement.deadlineAt ? new Date(match.announcement.deadlineAt) : null;
  const deadlineStr = deadlineDate ? format(deadlineDate, "dd.MM.yyyy HH:mm") : "Brak terminu";
  
  let timeRemaining = "";
  if (deadlineDate) {
    const now = new Date();
    const diffH = differenceInHours(deadlineDate, now);
    const diffD = differenceInDays(deadlineDate, now);
    if (diffH < 0) {
      timeRemaining = "Po terminie";
    } else if (diffD > 0) {
      timeRemaining = `pozostało ${diffD} dni`;
    } else {
      timeRemaining = `pozostało ${diffH} godz.`;
    }
  }

  const reportSections = match.announcement.detailedReport 
    ? parseReportToSections(match.announcement.detailedReport) 
    : [];

  const aiSubjectSection = reportSections.find((s) => s.title.toLowerCase().includes("przedmiot zamówienia"));
  const aiCriteriaSection = reportSections.find((s) => 
    s.title.toLowerCase().includes("kryteria oceny") || 
    s.title.toLowerCase().includes("warunki handlowe")
  );
  const remainingSections = reportSections.filter((s) => s !== aiSubjectSection && s !== aiCriteriaSection);

  const exactValue = match.announcement.valueMax || match.announcement.valueMin;
  const fallbackAiValue = extractFallbackFromReport(match.announcement.detailedReport);
  const displayValue = exactValue || match.announcement.llmEstimatedValue || fallbackAiValue;
  const isAiEstimated = !exactValue && (!!match.announcement.llmEstimatedValue || !!fallbackAiValue);

  return (
    <Card className="flex flex-col overflow-hidden rounded-[32px] border border-primary/10 bg-card shadow-sm xl:flex-row">
      {/* RIGHT SIDE: Main Content */}
      <div className="flex flex-1 flex-col p-6 sm:p-8 xl:p-10">
        {/* Header Area */}
        <div className="flex flex-col items-start justify-between gap-6 md:flex-row">
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-4 text-xs font-bold uppercase tracking-widest text-muted-foreground">
              <div className="flex items-center gap-2">
                <Building2 className="size-4" />
                {match.topic.projectName || "Dopasowany Projekt"}
              </div>
              {isUrgent ? (
                <div className="inline-flex items-center rounded-full bg-blue-600 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white shadow-sm">
                  <AlertCircle className="mr-1.5 size-3" />
                  Pilne zlecenie
                </div>
              ) : (
                <div className="inline-flex items-center rounded-full bg-muted px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground ring-1 ring-border">
                  {MATCH_STATUS_LABELS[match.status] || "Aktywne"}
                </div>
              )}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <h2 className="text-2xl font-bold leading-tight text-foreground sm:text-3xl">
                {match.announcement.title}
              </h2>
              {match.announcement.kind && (
                <span className="inline-flex items-center rounded-md bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 ring-1 ring-inset ring-blue-700/10">
                  {KIND_LABELS[match.announcement.kind] ?? match.announcement.kind}
                </span>
              )}
            </div>
            <div className="mt-5 flex items-baseline gap-3">
              <span className="text-3xl font-extrabold tracking-tight text-blue-600 sm:text-4xl">
                {displayValue ? formatMoney(displayValue) : "Wartość nieznana"}
              </span>
              {displayValue && (
                <span className="text-xs font-bold uppercase tracking-wide text-blue-400">
                  PLN<br />
                  brutto {isAiEstimated && <span className="opacity-75 italic">(szacowana)</span>}
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-col items-center shrink-0">
            <MatchScoreRing similarity={match.similarity} size={140} showLabel={false} />
            <span className="mt-4 text-[11px] font-bold tracking-widest text-blue-600 uppercase">
              Dopasowanie
            </span>
          </div>
        </div>

        {/* Stats Row */}
        <div className="mt-10 grid grid-cols-2 gap-6 border-y border-border/60 py-6 sm:grid-cols-4">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Zamawiający</div>
            <div className="mt-1.5 text-sm font-semibold text-foreground truncate" title="Brak danych z systemu">
              {/* @ts-ignore - pole buyerName nie istnieje jeszcze w schemacie */}
              {match.announcement.buyerName || "Brak danych z systemu"}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Lokalizacja</div>
            <div className="mt-1.5 text-sm font-semibold text-foreground truncate" title="Brak danych">
              {/* @ts-ignore - pole buyerCity nie istnieje jeszcze w schemacie */}
              {match.announcement.buyerCity || "Brak danych"}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Termin składania ofert</div>
            <div className="mt-1.5 text-sm font-semibold text-foreground">
              {deadlineStr}
              {timeRemaining && (
                <span className={cn("ml-2 text-xs font-normal", timeRemaining === "Po terminie" ? "text-red-500" : "text-blue-600")}>
                  ({timeRemaining})
                </span>
              )}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Źródło</div>
            <div className="mt-1.5 text-sm font-semibold text-foreground">
              {SOURCE_LABELS[match.announcement.sourceSystem] ?? match.announcement.sourceSystem}
            </div>
          </div>
        </div>

        {/* Description */}
        {aiSubjectSection ? (
          <div className="mt-10">
            <div className="flex items-center gap-2 text-lg font-bold text-foreground">
              <FileText className="size-5 text-blue-600" />
              Opis projektu
            </div>
            <div className="mt-4 max-w-5xl">
              <ReportSegment content={aiSubjectSection.body} />
            </div>
          </div>
        ) : null}

        {/* Detailed Info Panel: AI Report & Contract Details */}
        <div className="mt-10 grid gap-8 lg:grid-cols-[2fr_1fr]">
          {/* Main AI Report sections */}
          <div>
            <div className="mb-6 flex items-center gap-2 text-base font-bold text-foreground">
              <CheckCircle2 className="size-5 text-blue-600" />
              Notatka AI (Raport)
            </div>
            {remainingSections.length > 0 ? (
              <div className="space-y-8">
                {remainingSections.map((section, idx) => (
                  <div key={idx} className="flex flex-col gap-2.5">
                    <h3 className="font-bold text-sm text-foreground">{section.title}</h3>
                    <ReportSegment content={section.body} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground italic">
                Brak szczegółowego raportu AI dla tego ogłoszenia.
              </div>
            )}
          </div>

          {/* Right Column: Kryteria oceny */}
          <div>
            <div className="mb-4 flex items-center gap-2 text-base font-bold text-foreground">
              <Info className="size-5 text-blue-600" />
              {aiCriteriaSection ? aiCriteriaSection.title : "Kryteria oceny i warunki handlowe"}
            </div>
            <div className="flex flex-col gap-4 rounded-2xl bg-slate-50 p-6 dark:bg-card/40 dark:border dark:border-border/50">
              {aiCriteriaSection ? (
                <ReportSegment content={aiCriteriaSection.body} />
              ) : (
                <div className="text-sm text-muted-foreground italic">Brak szczegółowych informacji w raporcie AI.</div>
              )}
            </div>
          </div>
        </div>

        {/* Bottom Actions Row */}
        <div className="mt-12 flex flex-col items-stretch gap-4 sm:flex-row sm:items-center">
          <a
              href={match.announcement.url}
            className={cn(
              buttonVariants(),
              "h-14 flex-1 rounded-2xl bg-blue-600 text-base font-bold text-white transition-colors hover:bg-blue-700"
            )}
          >
            Przejdź do oferty
          </a>
          
          <div className="flex gap-4 sm:gap-2">
            <button
              onClick={onOpenDetails}
              className="flex h-14 flex-1 items-center justify-center gap-2 rounded-2xl border-2 border-border text-foreground transition-colors hover:bg-muted sm:flex-none sm:px-6"
              title="Szczegóły i surowe dane"
            >
              <Link2 className="size-5" />
              <span className="font-semibold sm:hidden">Szczegóły</span>
            </button>
            <button
              onClick={onOpenReport}
              disabled={!reportAvailable}
              className="flex h-14 flex-1 items-center justify-center gap-2 rounded-2xl border-2 border-border text-foreground transition-colors hover:bg-muted disabled:opacity-50 sm:flex-none sm:px-6"
              title="Raport AI"
            >
              <Sparkles className="size-5" />
              <span className="font-semibold sm:hidden">Raport</span>
            </button>
            
            <div className="hidden h-8 w-px bg-border sm:block mx-1" />

            <button
              onClick={() => onStatusChange("DISMISSED")}
              disabled={statusPending}
              className={cn(
                "flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border-2 transition-colors",
                match.status === "DISMISSED"
                  ? "border-red-500 bg-red-50 text-red-600 dark:bg-red-950/30"
                  : "border-border text-foreground hover:border-red-200 hover:bg-red-50 hover:text-red-600 dark:hover:border-red-900/50 dark:hover:bg-red-950/30"
              )}
              title="Odrzuć"
            >
              <ThumbsDown className="size-6" />
            </button>
            <button
              onClick={() => onStatusChange("SHORTLISTED")}
              disabled={statusPending}
              className={cn(
                "flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border-2 transition-colors",
                match.status === "SHORTLISTED"
                  ? "border-green-500 bg-green-50 text-green-600 dark:bg-green-950/30"
                  : "border-border text-foreground hover:border-green-200 hover:bg-green-50 hover:text-green-600 dark:hover:border-green-900/50 dark:hover:bg-green-950/30"
              )}
              title="Wybierz"
            >
              <ThumbsUp className="size-6" />
            </button>
          </div>
        </div>
        
      </div>
    </Card>
  );
}
