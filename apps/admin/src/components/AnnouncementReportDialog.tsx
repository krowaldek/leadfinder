import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileText, RefreshCw, Copy, Check, AlignLeft, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Announcement } from "@leadfinder/contracts";
import { fetchAnnouncement, generateAnnouncementReport } from "@/features/announcements/announcements-api";

type ExtendedAnnouncement = Announcement & {
  displayTitle?: string;
  location?: string | null;
  contractingAuthority?: string | null;
};

interface AnnouncementReportDialogProps {
  announcement: Announcement | null;
  open: boolean;
  onClose: () => void;
  allowGeneration?: boolean;
  emptyStateMessage?: ReactNode;
}

export function AnnouncementReportDialog({
  announcement,
  open,
  onClose,
  allowGeneration = true,
  emptyStateMessage,
}: AnnouncementReportDialogProps) {
  const queryClient = useQueryClient();
  const [localReport, setLocalReport] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState("report");

  const announcementQuery = useQuery({
    queryKey: ["announcement", announcement?.id],
    queryFn: () => fetchAnnouncement(announcement!.id),
    enabled: open && Boolean(announcement?.id),
  });

  const resolvedAnnouncement = (announcementQuery.data?.data ?? announcement) as ExtendedAnnouncement | null;
  const report = localReport ?? resolvedAnnouncement?.detailedReport ?? null;
  const baseDescription = [
    resolvedAnnouncement?.contractingAuthority?.trim()
      ? `## Zamawiający\n${resolvedAnnouncement.contractingAuthority.trim()}`
      : null,
    resolvedAnnouncement?.location?.trim()
      ? `## Lokalizacja\n${resolvedAnnouncement.location.trim()}`
      : null,
    resolvedAnnouncement?.description?.trim() ?? null,
    resolvedAnnouncement?.searchContext?.trim()
      ? `## Kontekst bazowy\n${resolvedAnnouncement.searchContext.trim()}`
      : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  const generateMutation = useMutation({
    mutationFn: () => generateAnnouncementReport(resolvedAnnouncement!.id),
    onSuccess: (data) => {
      setLocalReport(data.data.detailedReport);
      setActiveTab("report");
      void queryClient.invalidateQueries({ queryKey: ["announcements"] });
      void queryClient.invalidateQueries({ queryKey: ["client-matches"] });
      void queryClient.invalidateQueries({ queryKey: ["announcement", resolvedAnnouncement?.id] });
      toast.success("Raport został wygenerowany");
    },
    onError: () => toast.error("Nie udało się wygenerować raportu"),
  });

  async function handleCopy() {
    const contentToCopy = activeTab === "report" ? report : baseDescription;
    if (!contentToCopy) return;
    await navigator.clipboard.writeText(contentToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleOpenChange(isOpen: boolean) {
    if (!isOpen) {
      setLocalReport(null);
      setActiveTab("report");
      onClose();
    }
  }

  const hasActiveContent = activeTab === "report" ? Boolean(report) : Boolean(baseDescription);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-full max-w-6xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 px-6 pt-6 pb-4">
          <DialogTitle className="flex items-center gap-2 text-base">
            <FileText className="size-4 shrink-0 text-muted-foreground" />
            Raport analityczny
          </DialogTitle>
          {resolvedAnnouncement && (
            <DialogDescription className="text-sm">
              {resolvedAnnouncement.displayTitle ?? resolvedAnnouncement.title}
            </DialogDescription>
          )}
        </DialogHeader>

        <Separator className="shrink-0" />

        <div className="flex shrink-0 items-center gap-2 px-6 py-3">
          {allowGeneration ? (
            <Button
              size="sm"
              onClick={() => generateMutation.mutate()}
              disabled={generateMutation.isPending || !resolvedAnnouncement}
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
          ) : null}

          {hasActiveContent ? (
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
          ) : null}

          {hasActiveContent ? (
            <span className="ml-auto text-xs text-muted-foreground">
              {(activeTab === "report" ? report : baseDescription)!.length.toLocaleString("pl-PL")} znaków
            </span>
          ) : null}
        </div>

        <Separator className="shrink-0" />

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="px-6 py-5">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-5">
              <TabsList>
                <TabsTrigger value="report" className="gap-2">
                  <Sparkles className="size-4" />
                  Raport LLM
                </TabsTrigger>
                <TabsTrigger value="base" className="gap-2">
                  <AlignLeft className="size-4" />
                  Podstawowy opis
                </TabsTrigger>
              </TabsList>

              <TabsContent value="report" className="mt-0">
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
                  <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
                    <FileText className="size-8 text-muted-foreground/30" />
                    <div className="space-y-1">
                      <p className="text-sm font-medium">Brak raportu LLM</p>
                      <p className="text-xs text-muted-foreground">
                        {emptyStateMessage ?? (
                          <>
                            Kliknij „Generuj raport”, aby przeprowadzić analizę ogłoszenia.
                            <br />
                            Raport zostanie wygenerowany na podstawie treści ogłoszenia i załączników.
                          </>
                        )}
                      </p>
                    </div>
                    {allowGeneration ? (
                      <Button onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending || !resolvedAnnouncement}>
                        <FileText className="mr-1.5 size-4" />
                        Generuj raport
                      </Button>
                    ) : null}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="base" className="mt-0">
                {baseDescription ? (
                  <ReportContent content={baseDescription} />
                ) : (
                  <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                    <AlignLeft className="size-8 text-muted-foreground/30" />
                    <p className="text-sm font-medium">Brak podstawowego opisu</p>
                    <p className="text-xs text-muted-foreground">
                      To ogłoszenie nie ma zapisanego opisu źródłowego ani dodatkowego kontekstu.
                    </p>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </DialogContent>
    </Dialog>
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
        if (line.startsWith("# ") && !line.startsWith("## ")) {
          return (
            <h1 key={i} className="mt-2 mb-3 text-lg font-bold first:mt-0">
              {line.slice(2)}
            </h1>
          );
        }
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
