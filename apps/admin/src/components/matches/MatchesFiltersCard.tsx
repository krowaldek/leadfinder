import type { ReactNode } from "react";
import { Search, RefreshCw, Sparkles } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface Option {
  id: string;
  label: string;
}

interface MatchesFiltersCardProps {
  clients: Option[];
  projects: Option[];
  topics: Option[];
  selectedClientId: string;
  selectedProjectId: string;
  selectedTopicId: string;
  search: string;
  sortBy: string;
  hideDismissed: boolean;
  hideExpired: boolean;
  rematchPending: boolean;
  onClientChange: (value: string) => void;
  onProjectChange: (value: string) => void;
  onTopicChange: (value: string) => void;
  onSearchChange: (value: string) => void;
  onSortChange: (value: string) => void;
  onHideDismissedChange: (value: boolean) => void;
  onHideExpiredChange: (value: boolean) => void;
  onRematch: () => void;
}

const SORT_OPTIONS = [
  { value: "deadlineAt:asc", label: "Termin rosnąco" },
  { value: "similarity:desc", label: "Najlepsze dopasowanie" },
  { value: "publishedAt:desc", label: "Najnowsze publikacje" },
  { value: "title:asc", label: "Tytuł A–Z" },
] as const;

function FilterToggle({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? "default" : "outline"}
      className={cn(
        "h-8 rounded-full px-3",
        active ? "shadow-[0_12px_32px_-18px_rgba(59,130,246,0.9)]" : "bg-background/70",
      )}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

export function MatchesFiltersCard({
  clients,
  projects,
  topics,
  selectedClientId,
  selectedProjectId,
  selectedTopicId,
  search,
  sortBy,
  hideDismissed,
  hideExpired,
  rematchPending,
  onClientChange,
  onProjectChange,
  onTopicChange,
  onSearchChange,
  onSortChange,
  onHideDismissedChange,
  onHideExpiredChange,
  onRematch,
}: MatchesFiltersCardProps) {
  return (
    <Card className="overflow-visible border border-primary/10 bg-[radial-gradient(circle_at_top_right,rgba(59,130,246,0.16),transparent_38%),linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.98))] shadow-[0_30px_80px_-48px_rgba(37,99,235,0.55)] dark:bg-[radial-gradient(circle_at_top_right,rgba(59,130,246,0.2),transparent_34%),linear-gradient(180deg,rgba(15,23,42,0.96),rgba(15,23,42,0.9))]">
      <CardHeader className="gap-3 border-b border-border/60 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="rounded-full px-2.5 py-1 text-[11px] uppercase tracking-[0.18em]">
                Hero Match View
              </Badge>
              <Badge variant="outline" className="rounded-full px-2.5 py-1 text-[11px]">
                <Sparkles className="size-3" />
                Focus on fit
              </Badge>
            </div>
            <CardTitle className="text-xl font-semibold tracking-tight">Dopasowane oferty</CardTitle>
            <CardDescription>
              Wybierz klienta i pracuj na jednym, czytelnym widoku dopasowania zamiast tabeli technicznej.
            </CardDescription>
          </div>
          <Button type="button" size="sm" onClick={onRematch} disabled={!selectedClientId || rematchPending}>
            <RefreshCw className={cn("size-3.5", rematchPending && "animate-spin")} />
            {rematchPending ? "Przeliczam…" : "Przelicz dopasowania"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-5 pt-5">
        <div className="grid gap-4 xl:grid-cols-[1.1fr_1fr_1fr_1fr]">
          <div className="grid gap-1.5">
            <Label>Klient</Label>
            <Select value={selectedClientId || "ALL"} onValueChange={(value) => onClientChange(value && value !== "ALL" ? value : "") }>
              <SelectTrigger className="h-10 w-full rounded-2xl border-primary/10 bg-background/70 px-3 text-sm shadow-sm">
                <SelectValue placeholder="Wybierz klienta" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">— wybierz klienta —</SelectItem>
                {clients.map((client) => (
                  <SelectItem key={client.id} value={client.id}>{client.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label>Projekt</Label>
            <Select value={selectedProjectId || "ALL"} onValueChange={(value) => onProjectChange(value && value !== "ALL" ? value : "") }>
              <SelectTrigger className="h-10 w-full rounded-2xl border-primary/10 bg-background/70 px-3 text-sm shadow-sm" disabled={!selectedClientId}>
                <SelectValue placeholder="Wszystkie projekty" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">— wszystkie projekty —</SelectItem>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>{project.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label>Temat</Label>
            <Select value={selectedTopicId || "ALL"} onValueChange={(value) => onTopicChange(value && value !== "ALL" ? value : "") }>
              <SelectTrigger className="h-10 w-full rounded-2xl border-primary/10 bg-background/70 px-3 text-sm shadow-sm" disabled={!selectedProjectId}>
                <SelectValue placeholder="Wszystkie tematy" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">— wszystkie tematy —</SelectItem>
                {topics.map((topic) => (
                  <SelectItem key={topic.id} value={topic.id}>{topic.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label>Sortowanie</Label>
            <Select value={sortBy} onValueChange={(value) => value && onSortChange(value)}>
              <SelectTrigger className="h-10 w-full rounded-2xl border-primary/10 bg-background/70 px-3 text-sm shadow-sm">
                <SelectValue placeholder="Sortowanie" />
              </SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1fr_auto] xl:items-end">
          <div className="grid gap-1.5">
            <Label>Wyszukiwanie</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder="Szukaj po tytule, opisie lub kontekście ogłoszenia…"
                className="h-11 rounded-2xl border-primary/10 bg-background/80 pl-10 shadow-sm"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 xl:justify-end">
            <FilterToggle active={hideDismissed} onClick={() => onHideDismissedChange(!hideDismissed)}>
              Ukryj odrzucone
            </FilterToggle>
            <FilterToggle active={hideExpired} onClick={() => onHideExpiredChange(!hideExpired)}>
              Ukryj po terminie
            </FilterToggle>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
