import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileText, RefreshCw, Copy, Check } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import type { Announcement } from "@leadfinder/contracts";
import { generateAnnouncementReport } from "@/features/announcements/announcements-api";

interface AnnouncementReportDialogProps {
  announcement: Announcement | null;
  open: boolean;
  onClose: () => void;
}

export function AnnouncementReportDialog({
  announcement,
  open,
  onClose,
}: AnnouncementReportDialogProps) {
  const queryClient = useQueryClient();
  const [localReport, setLocalReport] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const report = localReport ?? announcement?.detailedReport ?? null;

  const generateMutation = useMutation({
    mutationFn: () => generateAnnouncementReport(announcement!.id),
    onSuccess: (data) => {
      setLocalReport(data.data.detailedReport);
      // odśwież cache listy ogłoszeń żeby detailedReport był aktualny
      void queryClient.invalidateQueries({ queryKey: ["announcements"] });
      toast.success("Raport został wygenerowany");
    },
    onError: () => toast.error("Nie udało się wygenerować raportu"),
  });

  async function handleCopy() {
    if (!report) return;
    await navigator.clipboard.writeText(report);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Resetuj lokalny raport gdy zamykamy dialog
  function handleOpenChange(isOpen: boolean) {
    if (!isOpen) {
      setLocalReport(null);
      onClose();
    }
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl"
      >
        <SheetHeader className="px-6 pt-6 pb-4">
          <SheetTitle className="flex items-center gap-2 text-base">
            <FileText className="size-4 shrink-0 text-muted-foreground" />
            Raport analityczny
          </SheetTitle>
          {announcement && (
            <SheetDescription className="line-clamp-2 text-sm">
              {announcement.title}
            </SheetDescription>
          )}
        </SheetHeader>

        <Separator />

        {/* Toolbar */}
        <div className="flex items-center gap-2 px-6 py-3">
          <Button
            size="sm"
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending || !announcement}
          >
            {generateMutation.isPending ? (
              <>
                <RefreshCw className="mr-1.5 size-3.5 animate-spin" />
                Generowanie…
              </>
            ) : report ? (
              <>
                <RefreshCw className="mr-1.5 size-3.5" />
                Regeneruj raport
              </>
            ) : (
              <>
                <FileText className="mr-1.5 size-3.5" />
                Generuj raport
              </>
            )}
          </Button>

          {report && (
            <Button size="sm" variant="outline" onClick={handleCopy}>
              {copied ? (
                <>
                  <Check className="mr-1.5 size-3.5 text-green-500" />
                  Skopiowano
                </>
              ) : (
                <>
                  <Copy className="mr-1.5 size-3.5" />
                  Kopiuj
                </>
              )}
            </Button>
          )}

          {report && (
            <span className="ml-auto text-xs text-muted-foreground">
              {report.length.toLocaleString("pl-PL")} znaków
            </span>
          )}
        </div>

        <Separator />

        {/* Treść raportu */}
        <ScrollArea className="flex-1">
          <div className="px-6 py-4">
            {generateMutation.isPending ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                <RefreshCw className="size-8 animate-spin text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  Analizuję dokumenty i generuję raport…
                </p>
                <p className="text-xs text-muted-foreground/60">
                  Może to potrwać kilkanaście sekund
                </p>
              </div>
            ) : report ? (
              <ReportContent content={report} />
            ) : (
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                <FileText className="size-8 text-muted-foreground/30" />
                <p className="text-sm font-medium">Brak raportu</p>
                <p className="text-xs text-muted-foreground">
                  Kliknij „Generuj raport", aby przeprowadzić analizę ogłoszenia.
                  <br />
                  Raport zostanie wygenerowany na podstawie treści ogłoszenia
                  {announcement?.items?.some((i) => i.shortSummary) ? " i podsumowań pozycji." : "."}
                </p>
              </div>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Renderuje treść raportu (Markdown) jako sformatowany HTML.
 * Minimalne parsowanie bez zewnętrznych zależności.
 */
function ReportContent({ content }: { content: string }) {
  const lines = content.split("\n");

  return (
    <div className="space-y-1 text-sm leading-relaxed">
      {lines.map((line, i) => {
        if (line.startsWith("## ")) {
          return (
            <h2 key={i} className="mt-5 mb-1.5 text-base font-semibold first:mt-0">
              {line.slice(3)}
            </h2>
          );
        }
        if (line.startsWith("### ")) {
          return (
            <h3 key={i} className="mt-4 mb-1 text-sm font-semibold text-foreground/90">
              {line.slice(4)}
            </h3>
          );
        }
        if (line.startsWith("- ") || line.startsWith("* ")) {
          return (
            <div key={i} className="flex gap-2 pl-2">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
              <span>{renderInline(line.slice(2))}</span>
            </div>
          );
        }
        if (/^\d+\.\s/.test(line)) {
          const match = line.match(/^(\d+)\.\s(.*)$/);
          if (match) {
            return (
              <div key={i} className="flex gap-2 pl-2">
                <span className="text-muted-foreground">{match[1]}.</span>
                <span>{renderInline(match[2])}</span>
              </div>
            );
          }
        }
        if (line.startsWith("---")) {
          return <hr key={i} className="my-3 border-border" />;
        }
        if (line.trim() === "") {
          return <div key={i} className="h-2" />;
        }
        return (
          <p key={i} className="text-foreground/90">
            {renderInline(line)}
          </p>
        );
      })}
    </div>
  );
}

/** Renderuje inline markdown: **bold**, *italic* */
function renderInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*)/g;
  let lastIdx = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push(text.slice(lastIdx, match.index));
    }
    if (match[2]) {
      parts.push(<strong key={match.index}>{match[2]}</strong>);
    } else if (match[3]) {
      parts.push(<em key={match.index}>{match[3]}</em>);
    }
    lastIdx = match.index + match[0].length;
  }

  if (lastIdx < text.length) {
    parts.push(text.slice(lastIdx));
  }

  return parts.length === 1 ? parts[0] : parts;
}
