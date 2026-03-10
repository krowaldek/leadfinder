import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { ExternalLink } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { searchModeSchema, type SearchMode, type SearchResultItem } from "@leadfinder/contracts";
import { searchAnnouncementsAi } from "@/features/announcements/announcements-api";
import { cn } from "@/lib/utils";

const searchFormSchema = z.object({
  q: z.string().trim().min(3, "Wpisz co najmniej 3 znaki."),
  mode: searchModeSchema,
  limit: z.number().int().min(1).max(30),
  threshold: z.number().min(0).max(1),
});

type SearchFormValues = z.infer<typeof searchFormSchema>;

const MODE_OPTIONS: Array<{ value: SearchMode; label: string; hint: string }> = [
  { value: "HYBRID", label: "Hybrid", hint: "Semantyka + słowa kluczowe, dobry tryb domyślny." },
  { value: "RERANK", label: "Rerank", hint: "Dodatkowy etap LLM poprawia kolejność top wyników." },
  { value: "QUERY_EXPANSION", label: "Query Expansion", hint: "LLM rozszerza zapytanie o synonimy." },
  { value: "LEARNING_TO_RANK", label: "Learning To Rank", hint: "Wynik uwzględnia historyczny feedback." },
  { value: "MULTI_STAGE", label: "Multi-stage", hint: "Szerokie wyszukanie, potem dokładny scoring." },
  { value: "DOMAIN_AWARE", label: "Domain-aware", hint: "Dodatkowe reguły domenowe: budżet, termin, źródło." },
  { value: "MULTI_VECTOR", label: "Multi-vector", hint: "Kilka wariantów zapytania wektorowego." },
  { value: "DIVERSIFIED", label: "Diversified", hint: "Ogranicza duplikaty podobnych wyników." },
  { value: "VECTOR", label: "Vector Baseline", hint: "Czysty baseline semantyczny do porównań A/B." },
];

interface AnnouncementAiSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function scoreVariant(score: number): "default" | "secondary" | "outline" {
  if (score >= 0.75) return "default";
  if (score >= 0.5) return "secondary";
  return "outline";
}

function BreakdownChip({ label, value }: { label: string; value: number | null }) {
  if (value == null) return null;
  return (
    <Badge variant="outline" className="text-xs font-normal">
      {label}: {(value * 100).toFixed(0)}%
    </Badge>
  );
}

function ResultCard({ item, index }: { item: SearchResultItem; index: number }) {
  return (
    <article className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">#{index + 1} · {item.source}</p>
          <h4 className="mt-1 line-clamp-2 text-sm font-semibold">{item.title}</h4>
          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{item.announcementTitle}</p>
        </div>
        <Badge variant={scoreVariant(item.score)} className="tabular-nums shrink-0">
          {(item.score * 100).toFixed(0)}%
        </Badge>
      </div>

      {item.description && (
        <p className="mt-3 line-clamp-2 text-xs leading-5 text-muted-foreground">{item.description}</p>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5">
        <BreakdownChip label="Sem." value={item.scores.semantic} />
        <BreakdownChip label="Keyword" value={item.scores.keyword} />
        <BreakdownChip label="Domain" value={item.scores.domain} />
        <BreakdownChip label="Rerank" value={item.scores.rerank} />
        <BreakdownChip label="Feedback" value={item.scores.feedback} />
        <BreakdownChip label="Diversity" value={item.scores.diversity} />
      </div>

      {item.explanations.length > 0 && (
        <div className="mt-3 rounded-md border border-dashed bg-muted/40 p-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Dlaczego ten wynik</p>
          <div className="mt-2 space-y-1">
            {item.explanations.map((note) => (
              <p key={note} className="text-xs text-muted-foreground">{note}</p>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
        <span>Publikacja: {item.publishedAt ? format(new Date(item.publishedAt), "dd.MM.yyyy") : "—"}</span>
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
        >
          Otwórz <ExternalLink className="size-3" />
        </a>
      </div>
    </article>
  );
}

export function AnnouncementAiSearchDialog({ open, onOpenChange }: AnnouncementAiSearchDialogProps) {
  const form = useForm<SearchFormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(searchFormSchema as any),
    defaultValues: { q: "", mode: "HYBRID", limit: 12, threshold: 0.3 },
  });

  const selectedMode = form.watch("mode");
  const modeHint = MODE_OPTIONS.find((o) => o.value === selectedMode)?.hint;

  const searchMutation = useMutation({
    mutationFn: (values: SearchFormValues) => searchAnnouncementsAi(values),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(90vh,860px)] w-[min(94vw,1100px)] max-w-none flex-col p-0 gap-0">
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <DialogTitle>AI Match Lab</DialogTitle>
          <DialogDescription>
            Wpisz zapytanie, wybierz tryb i porównuj jakość dopasowania ogłoszeń.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[340px_1fr]">
          {/* Controls panel */}
          <div className="border-r p-4">
            <form
              className="grid gap-4"
              onSubmit={form.handleSubmit((values) => searchMutation.mutate(values))}
            >
              <div className="grid gap-2">
                <Label htmlFor="q">Zapytanie</Label>
                <textarea
                  id="q"
                  rows={5}
                  placeholder="np. modernizacja serwerowni i backup w chmurze"
                  {...form.register("q")}
                  className={cn(
                    "flex w-full resize-none rounded-lg border bg-transparent px-3 py-2 text-sm outline-none transition placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
                    form.formState.errors.q ? "border-destructive" : "border-input",
                  )}
                />
                {form.formState.errors.q && (
                  <p className="text-xs text-destructive">{form.formState.errors.q.message}</p>
                )}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="mode">Tryb dopasowania</Label>
                <select
                  id="mode"
                  {...form.register("mode")}
                  className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {MODE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                {modeHint && <p className="text-xs text-muted-foreground">{modeHint}</p>}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label htmlFor="limit">Limit</Label>
                  <Input
                    id="limit"
                    type="number"
                    min={1}
                    max={30}
                    {...form.register("limit", { valueAsNumber: true })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="threshold">Próg AI</Label>
                  <Input
                    id="threshold"
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    {...form.register("threshold", { valueAsNumber: true })}
                  />
                </div>
              </div>

              <Button type="submit" disabled={searchMutation.isPending} className="w-full">
                {searchMutation.isPending ? "Szukam..." : "Uruchom"}
              </Button>
            </form>
          </div>

          {/* Results panel */}
          <div className="flex min-h-0 flex-col">
            {searchMutation.isIdle && (
              <div className="grid flex-1 place-items-center p-6">
                <p className="max-w-sm text-center text-sm text-muted-foreground">
                  Wybierz tryb i uruchom zapytanie. Otrzymasz listę dopasowanych ogłoszeń
                  z rozbiciem score dla każdej metody.
                </p>
              </div>
            )}

            {searchMutation.isError && (
              <div className="m-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                Nie udało się wykonać wyszukiwania. Sprawdź API i spróbuj ponownie.
              </div>
            )}

            {searchMutation.data && (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="flex flex-wrap items-center gap-3 border-b px-4 py-2 text-xs text-muted-foreground">
                  <span>Tryb: <strong className="text-foreground">{searchMutation.data.meta.mode}</strong></span>
                  <Separator orientation="vertical" className="h-4" />
                  <span>Wyniki: <strong className="text-foreground">{searchMutation.data.meta.count}</strong></span>
                  <Separator orientation="vertical" className="h-4" />
                  <span className="truncate">Query: <strong className="text-foreground">{searchMutation.data.meta.effectiveQuery}</strong></span>
                </div>
                <ScrollArea className="flex-1 p-4">
                  <div className="space-y-3">
                    {searchMutation.data.data.length === 0 && (
                      <p className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
                        Brak dopasowań dla tego zapytania.
                      </p>
                    )}
                    {searchMutation.data.data.map((item, index) => (
                      <ResultCard key={item.id} item={item} index={index} />
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}


