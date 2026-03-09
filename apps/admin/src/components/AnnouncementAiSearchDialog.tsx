import * as Dialog from "@radix-ui/react-dialog";
import { useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { ExternalLink, X } from "lucide-react";
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
  {
    value: "HYBRID",
    label: "Hybrid",
    hint: "Semantyka + słowa kluczowe, dobry tryb domyślny.",
  },
  {
    value: "RERANK",
    label: "Rerank",
    hint: "Dodatkowy etap LLM poprawia kolejność top wyników.",
  },
  {
    value: "QUERY_EXPANSION",
    label: "Query Expansion",
    hint: "LLM rozszerza zapytanie o synonimy i warianty branżowe.",
  },
  {
    value: "LEARNING_TO_RANK",
    label: "Learning To Rank",
    hint: "Wynik uwzględnia historyczny feedback użytkowników.",
  },
  {
    value: "MULTI_STAGE",
    label: "Multi-stage",
    hint: "Szerokie wyszukanie, potem dokładny scoring finalny.",
  },
  {
    value: "DOMAIN_AWARE",
    label: "Domain-aware",
    hint: "Dodatkowe reguły domenowe: budżet, termin, źródło.",
  },
  {
    value: "MULTI_VECTOR",
    label: "Multi-vector",
    hint: "Kilka wariantów zapytania wektorowego, lepszy recall.",
  },
  {
    value: "DIVERSIFIED",
    label: "Diversified",
    hint: "Dywersyfikuje listę, ogranicza duplikaty podobnych wyników.",
  },
  {
    value: "VECTOR",
    label: "Vector Baseline",
    hint: "Czysty baseline semantyczny do porównań A/B.",
  },
];

interface AnnouncementAiSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function scoreClass(score: number) {
  if (score >= 0.75) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 0.5) return "text-amber-600 dark:text-amber-400";
  return "text-stone-500 dark:text-stone-400";
}

function BreakdownChip({ label, value }: { label: string; value: number | null }) {
  if (value == null) return null;
  return (
    <span className="rounded-full border border-stone-200 px-2.5 py-1 text-[11px] text-stone-600 dark:border-stone-700 dark:text-stone-300">
      {label}: {(value * 100).toFixed(0)}%
    </span>
  );
}

function ResultCard({ item, index }: { item: SearchResultItem; index: number }) {
  return (
    <article className="rounded-2xl border border-stone-200 bg-white/80 p-4 dark:border-stone-700 dark:bg-stone-900/70">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.25em] text-stone-400">
            #{index + 1} · {item.source}
          </p>
          <h4 className="mt-1 line-clamp-2 text-sm font-semibold text-stone-900 dark:text-stone-100">
            {item.title}
          </h4>
          <p className="mt-1 line-clamp-1 text-xs text-stone-500 dark:text-stone-400">
            {item.announcementTitle}
          </p>
        </div>
        <div className="text-right">
          <p className={cn("text-lg font-semibold tabular-nums", scoreClass(item.score))}>
            {(item.score * 100).toFixed(0)}%
          </p>
          <p className="text-[11px] uppercase tracking-[0.18em] text-stone-400">score</p>
        </div>
      </div>

      {item.description && (
        <p className="mt-3 line-clamp-2 text-xs leading-5 text-stone-600 dark:text-stone-300">
          {item.description}
        </p>
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
        <div className="mt-3 rounded-xl border border-dashed border-stone-200 bg-stone-50/80 p-3 dark:border-stone-700 dark:bg-stone-800/60">
          <p className="text-[11px] uppercase tracking-[0.2em] text-stone-500 dark:text-stone-400">
            Dlaczego ten wynik
          </p>
          <div className="mt-2 space-y-1.5">
            {item.explanations.map((note) => (
              <p key={note} className="text-xs leading-5 text-stone-600 dark:text-stone-300">
                {note}
              </p>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3 flex items-center justify-between text-xs text-stone-500 dark:text-stone-400">
        <span>
          Publikacja:{" "}
          {item.publishedAt ? format(new Date(item.publishedAt), "dd.MM.yyyy") : "—"}
        </span>
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 underline hover:text-amber-600 dark:hover:text-amber-400"
        >
          Otwórz <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
    </article>
  );
}

export function AnnouncementAiSearchDialog({
  open,
  onOpenChange,
}: AnnouncementAiSearchDialogProps) {
  const form = useForm<SearchFormValues>({
    resolver: zodResolver(searchFormSchema),
    defaultValues: {
      q: "",
      mode: "HYBRID",
      limit: 12,
      threshold: 0.3,
    },
  });

  const selectedMode = form.watch("mode");
  const modeHint = MODE_OPTIONS.find((option) => option.value === selectedMode)?.hint;

  const searchMutation = useMutation({
    mutationFn: (values: SearchFormValues) => searchAnnouncementsAi(values),
  });

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-stone-950/60 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 grid h-[min(90vh,860px)] w-[min(94vw,1100px)] -translate-x-1/2 -translate-y-1/2 grid-rows-[auto_1fr] overflow-hidden rounded-[2rem] border border-stone-200 bg-[#fdfbf7] shadow-[0_35px_110px_rgba(0,0,0,0.35)] dark:border-stone-700 dark:bg-stone-900">
          <header className="flex items-start justify-between gap-4 border-b border-stone-200 px-6 py-5 dark:border-stone-700">
            <div>
              <Dialog.Title className="font-[Cormorant_Garamond] text-3xl font-semibold text-stone-900 dark:text-stone-100">
                AI Match Lab
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-stone-600 dark:text-stone-400">
                Wpisz zapytanie, wybierz tryb i porównuj jakość dopasowania ogłoszeń.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-full border border-stone-200 p-2 text-stone-500 transition hover:bg-stone-100 dark:border-stone-700 dark:text-stone-400 dark:hover:bg-stone-800"
                aria-label="Zamknij"
              >
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </header>

          <div className="grid min-h-0 gap-5 p-6 lg:grid-cols-[360px_1fr]">
            <section className="rounded-2xl border border-stone-200 bg-white/80 p-4 dark:border-stone-700 dark:bg-stone-900/50">
              <form
                className="grid gap-4"
                onSubmit={form.handleSubmit((values) => searchMutation.mutate(values))}
              >
                <label className="grid gap-2">
                  <span className="text-xs uppercase tracking-[0.2em] text-stone-500">
                    Zapytanie
                  </span>
                  <textarea
                    rows={5}
                    placeholder="np. modernizacja serwerowni i backup w chmurze dla jednostki publicznej"
                    {...form.register("q")}
                    className={cn(
                      "resize-none rounded-2xl border bg-white px-4 py-3 text-sm outline-none transition dark:bg-stone-950 dark:text-stone-100",
                      form.formState.errors.q
                        ? "border-rose-500"
                        : "border-stone-200 focus:border-amber-500 dark:border-stone-700 dark:focus:border-amber-500",
                    )}
                  />
                  {form.formState.errors.q && (
                    <span className="text-xs text-rose-600 dark:text-rose-400">
                      {form.formState.errors.q.message}
                    </span>
                  )}
                </label>

                <label className="grid gap-2">
                  <span className="text-xs uppercase tracking-[0.2em] text-stone-500">
                    Tryb dopasowania
                  </span>
                  <select
                    {...form.register("mode")}
                    className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-amber-500 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100 dark:focus:border-amber-500"
                  >
                    {MODE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs leading-5 text-stone-500 dark:text-stone-400">{modeHint}</p>
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <label className="grid gap-2">
                    <span className="text-xs uppercase tracking-[0.2em] text-stone-500">Limit</span>
                    <input
                      type="number"
                      min={1}
                      max={30}
                      {...form.register("limit", { valueAsNumber: true })}
                      className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-amber-500 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100 dark:focus:border-amber-500"
                    />
                  </label>
                  <label className="grid gap-2">
                    <span className="text-xs uppercase tracking-[0.2em] text-stone-500">
                      Próg AI
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={1}
                      step={0.05}
                      {...form.register("threshold", { valueAsNumber: true })}
                      className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-amber-500 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100 dark:focus:border-amber-500"
                    />
                  </label>
                </div>

                <button
                  type="submit"
                  disabled={searchMutation.isPending}
                  className="mt-1 rounded-full bg-stone-950 px-5 py-2 text-xs font-medium uppercase tracking-[0.2em] text-stone-100 transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-amber-700 dark:hover:bg-amber-600"
                >
                  {searchMutation.isPending ? "Szukam..." : "Uruchom tryb"}
                </button>
              </form>
            </section>

            <section className="min-h-0 rounded-2xl border border-stone-200 bg-white/70 p-4 dark:border-stone-700 dark:bg-stone-900/40">
              {searchMutation.isIdle && (
                <div className="grid h-full place-items-center rounded-xl border border-dashed border-stone-200 dark:border-stone-700">
                  <p className="max-w-sm text-center text-sm leading-7 text-stone-500 dark:text-stone-400">
                    Wybierz tryb i uruchom zapytanie. Otrzymasz listę dopasowanych ogłoszeń z
                    rozbiciem score, żeby łatwo porównać metody.
                  </p>
                </div>
              )}

              {searchMutation.isError && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-300">
                  Nie udało się wykonać wyszukiwania. Sprawdź API i spróbuj ponownie.
                </div>
              )}

              {searchMutation.data && (
                <div className="flex h-full min-h-0 flex-col">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-stone-200 bg-stone-50/80 px-3 py-2 text-xs text-stone-600 dark:border-stone-700 dark:bg-stone-800/60 dark:text-stone-300">
                    <span>
                      Tryb:{" "}
                      <strong>{searchMutation.data.meta.mode}</strong>
                    </span>
                    <span>
                      Wyniki:{" "}
                      <strong>{searchMutation.data.meta.count}</strong>
                    </span>
                    <span>
                      Effective query:{" "}
                      <strong className="font-medium">{searchMutation.data.meta.effectiveQuery}</strong>
                    </span>
                  </div>

                  <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
                    {searchMutation.data.data.length === 0 && (
                      <p className="rounded-xl border border-dashed border-stone-300 px-4 py-8 text-center text-sm text-stone-500 dark:border-stone-700 dark:text-stone-400">
                        Brak dopasowań dla tego zapytania w wybranym trybie.
                      </p>
                    )}
                    {searchMutation.data.data.map((item, index) => (
                      <ResultCard key={item.id} item={item} index={index} />
                    ))}
                  </div>
                </div>
              )}
            </section>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
