import { CalendarClock, ChevronRight, ExternalLink, Layers3, Wallet } from "lucide-react";
import { ClientMatchResponse } from "@leadfinder/contracts";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  formatDateTime,
  formatMoney,
  getDeadlineMeta,
  getSimilarityMeta,
  KIND_LABELS,
  SOURCE_LABELS,
} from "./match-meta";

interface MatchListRailProps {
  matches: ClientMatchResponse[];
  selectedMatchId: string | null;
  onSelect: (matchId: string) => void;
}

export function MatchListRail({ matches, selectedMatchId, onSelect }: MatchListRailProps) {
  return (
    <div className="overflow-hidden rounded-[28px] border border-primary/10 bg-card/90 shadow-[0_25px_70px_-52px_rgba(15,23,42,0.65)] backdrop-blur">
      <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
        <div>
          <p className="text-sm font-semibold text-foreground">Pozostałe oferty</p>
          <p className="text-xs text-muted-foreground">Kliknij kartę, aby przejść do szczegółów dopasowania.</p>
        </div>
        <Badge variant="secondary" className="rounded-full px-2.5 py-1">{matches.length}</Badge>
      </div>
      <ScrollArea className="h-[720px]">
        <div className="grid gap-3 p-4">
          {matches.map((match) => {
            const similarityMeta = getSimilarityMeta(match.similarity);
            const deadlineMeta = getDeadlineMeta(match.announcement.deadlineAt);
            const selected = match.id === selectedMatchId;

            return (
              <button
                key={match.id}
                type="button"
                onClick={() => onSelect(match.id)}
                className={cn(
                  "group rounded-[24px] border p-4 text-left transition-all duration-200",
                  selected
                    ? "border-primary/35 bg-primary/5 shadow-[0_20px_40px_-28px_rgba(37,99,235,0.75)]"
                    : "border-border/60 bg-background/80 hover:border-primary/20 hover:bg-primary/5",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline" className="rounded-full px-2.5 py-0.5 text-[11px]">
                        {SOURCE_LABELS[match.announcement.sourceSystem] ?? match.announcement.sourceSystem}
                      </Badge>
                      <Badge variant="secondary" className={cn("rounded-full px-2.5 py-0.5 text-[11px]", similarityMeta.tone)}>
                        {similarityMeta.label}
                      </Badge>
                    </div>
                    <h3 className="line-clamp-2 text-sm font-semibold leading-5 text-foreground">{match.announcement.title}</h3>
                  </div>
                  <div className="flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-sm font-semibold text-primary">
                    {similarityMeta.percentage}%
                    <ChevronRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                  </div>
                </div>

                <div className="mt-3 grid gap-2 text-xs text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <Layers3 className="size-3.5" />
                    <span>{match.announcement.kind ? (KIND_LABELS[match.announcement.kind] ?? match.announcement.kind) : "Brak rodzaju"}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CalendarClock className="size-3.5" />
                    <span>{deadlineMeta.label}</span>
                    {match.announcement.deadlineAt ? <span>· {formatDateTime(match.announcement.deadlineAt)}</span> : null}
                  </div>
                  {match.announcement.llmEstimatedValue !== null ? (
                    <div className="flex items-center gap-2">
                      <Wallet className="size-3.5" />
                      <span>{formatMoney(match.announcement.llmEstimatedValue)}</span>
                    </div>
                  ) : null}
                </div>

                <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                  <span>{match.topic.projectName}</span>
                  {match.announcement.url ? (
                    <span className="inline-flex items-center gap-1 text-primary">
                      Źródło <ExternalLink className="size-3" />
                    </span>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
