import { type ComponentType, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type Announcement, type ClientMatchResponse } from "@leadfinder/contracts";
import { BarChart3, Sparkles, Target, XCircle } from "lucide-react";
import { toast } from "sonner";

import { AnnouncementReportDialog } from "@/components/AnnouncementReportDialog";
import { MatchDetailSheet } from "@/components/MatchDetailSheet";
import { FeaturedMatchCard } from "@/components/matches/FeaturedMatchCard";
import { MATCH_STATUS_LABELS } from "@/components/matches/match-meta";
import { MatchesFiltersCard } from "@/components/matches/MatchesFiltersCard";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import {
  fetchClientMatches,
  fetchClients,
  fetchProjects,
  fetchTopics,
  rematchClient,
  updateMatchStatus,
} from "./clients-api";

type SortOption = "deadlineAt:asc" | "similarity:desc" | "publishedAt:desc" | "title:asc";

function StatsCard({
  title,
  value,
  caption,
  icon: Icon,
  tone,
}: {
  title: string;
  value: number;
  caption: string;
  icon: ComponentType<{ className?: string }>;
  tone: string;
}) {
  return (
    <Card className="overflow-hidden rounded-[28px] border border-primary/10 bg-card/90 shadow-[0_20px_60px_-45px_rgba(15,23,42,0.55)]">
      <CardContent className="flex items-center justify-between gap-4 p-5">
        <div>
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <p className="mt-2 text-3xl font-semibold tracking-tight text-foreground">{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{caption}</p>
        </div>
        <div className={cn("flex size-12 items-center justify-center rounded-2xl text-white shadow-lg", tone)}>
          <Icon className="size-5" />
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <Card className="rounded-[32px] border border-dashed border-primary/20 bg-card/80 shadow-sm">
      <CardContent className="flex min-h-[320px] flex-col items-center justify-center gap-3 p-8 text-center">
        <div className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Sparkles className="size-6" />
        </div>
        <div className="space-y-1">
          <h3 className="text-lg font-semibold tracking-tight text-foreground">{title}</h3>
          <p className="max-w-xl text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function toReportAnnouncement(match: ClientMatchResponse): Announcement {
  return {
    id: match.announcement.id,
    title: match.announcement.title,
    detailedReport: match.announcement.detailedReport ?? null,
  } as Announcement;
}

export function ClientMatchesPage() {
  const [selectedClientId, setSelectedClientId] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedTopicId, setSelectedTopicId] = useState("");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("deadlineAt:asc");
  const [hideDismissed, setHideDismissed] = useState(true);
  const [hideExpired, setHideExpired] = useState(true);
  
  const [detailMatch, setDetailMatch] = useState<ClientMatchResponse | null>(null);
  const [reportTarget, setReportTarget] = useState<Announcement | null>(null);

  const queryClient = useQueryClient();

  const clientsQuery = useQuery({
    queryKey: ["clients", 1, 200],
    queryFn: () => fetchClients(1, 200),
  });

  const projectsQuery = useQuery({
    queryKey: ["projects", selectedClientId],
    queryFn: () => fetchProjects(selectedClientId),
    enabled: Boolean(selectedClientId),
  });

  const topicsQuery = useQuery({
    queryKey: ["topics", selectedClientId, selectedProjectId],
    queryFn: () => fetchTopics(selectedClientId, selectedProjectId),
    enabled: Boolean(selectedClientId && selectedProjectId),
  });

  const matchesQuery = useQuery({
    queryKey: ["client-matches", selectedClientId],
    queryFn: () => fetchClientMatches(selectedClientId),
    enabled: Boolean(selectedClientId),
  });

  const statusMutation = useMutation({
    mutationFn: ({
      matchId,
      status,
    }: {
      matchId: string;
      status: ClientMatchResponse["status"];
    }) => updateMatchStatus(selectedClientId, matchId, status),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["client-matches", selectedClientId] });
    },
    onError: () => toast.error("Błąd aktualizacji statusu"),
  });

  const rematchMutation = useMutation({
    mutationFn: (clientId: string) => rematchClient(clientId),
    onSuccess: (result, clientId) => {
      if (result.topicEmbeddingsQueued > 0) {
        toast.success(
          `Zakolejkowano ${result.topicEmbeddingsQueued} embedding${result.topicEmbeddingsQueued === 1 ? "" : "i"} tematów. Dopasowania pojawią się po ich przeliczeniu.`,
        );
      } else {
        toast.success("Przeliczenie dopasowań zakolejkowane");
      }
      void queryClient.invalidateQueries({ queryKey: ["client-matches", clientId] });
    },
    onError: () => toast.error("Nie udało się zakolejkować przeliczenia dopasowań"),
  });

  const clients = clientsQuery.data?.data ?? [];
  const projects = projectsQuery.data?.data ?? [];
  const topics = topicsQuery.data?.data ?? [];
  const allMatches = matchesQuery.data?.data ?? [];

  const filteredByScope = useMemo(() => {
    let rows = allMatches;

    if (selectedProjectId) {
      rows = rows.filter((match) => match.topic.projectId === selectedProjectId);
    }

    if (selectedTopicId) {
      rows = rows.filter((match) => match.topic.id === selectedTopicId);
    }

    return rows;
  }, [allMatches, selectedProjectId, selectedTopicId]);

  const total = filteredByScope.length;
  const shortlisted = filteredByScope.filter((match) => match.status === "SHORTLISTED").length;
  const dismissed = filteredByScope.filter((match) => match.status === "DISMISSED").length;

  const displayedMatches = useMemo(() => {
    let rows = hideDismissed ? filteredByScope.filter((match) => match.status !== "DISMISSED") : filteredByScope;

    if (hideExpired) {
      const now = new Date();
      rows = rows.filter((match) => {
        const deadline = match.announcement.deadlineAt;
        if (!deadline) return true;
        return new Date(deadline) > now;
      });
    }

    if (search.trim()) {
      const query = search.trim().toLowerCase();
      rows = rows.filter((match) => {
        const title = match.announcement.title.toLowerCase();
        const description = (match.announcement.description ?? "").toLowerCase();
        const context = (match.announcement.searchContext ?? "").toLowerCase();
        return title.includes(query) || description.includes(query) || context.includes(query);
      });
    }

    const [column, direction] = sortBy.split(":") as ["deadlineAt" | "similarity" | "publishedAt" | "title", "asc" | "desc"];

    return [...rows].sort((left, right) => {
      let comparison = 0;

      if (column === "deadlineAt") {
        const leftDeadline = left.announcement.deadlineAt ?? "";
        const rightDeadline = right.announcement.deadlineAt ?? "";
        if (!leftDeadline && !rightDeadline) comparison = 0;
        else if (!leftDeadline) comparison = 1;
        else if (!rightDeadline) comparison = -1;
        else comparison = leftDeadline.localeCompare(rightDeadline);
      } else if (column === "similarity") {
        comparison = left.similarity - right.similarity;
      } else if (column === "publishedAt") {
        comparison = (left.announcement.publishedAt ?? "").localeCompare(right.announcement.publishedAt ?? "");
      } else {
        comparison = left.announcement.title.localeCompare(right.announcement.title, "pl");
      }

      if (comparison === 0 && column !== "similarity") {
        comparison = right.similarity - left.similarity;
      }

      return direction === "asc" ? comparison : -comparison;
    });
  }, [filteredByScope, hideDismissed, hideExpired, search, sortBy]);

  const clientOptions = clients.map((client) => ({ id: client.id, label: client.companyName }));
  const projectOptions = projects.map((project) => ({ id: project.id, label: project.name }));
  const topicOptions = topics.map((topic) => ({ id: topic.id, label: topic.title }));
  const selectedClient = clients.find((client) => client.id === selectedClientId) ?? null;

  return (
    <div className="grid gap-6 pb-6">
      <MatchesFiltersCard
        clients={clientOptions}
        projects={projectOptions}
        topics={topicOptions}
        selectedClientId={selectedClientId}
        selectedProjectId={selectedProjectId}
        selectedTopicId={selectedTopicId}
        search={search}
        sortBy={sortBy}
        hideDismissed={hideDismissed}
        hideExpired={hideExpired}
        rematchPending={rematchMutation.isPending}
        onClientChange={(value) => {
          setSelectedClientId(value);
          setSelectedProjectId("");
          setSelectedTopicId("");
          setSearch("");
        }}
        onProjectChange={(value) => {
          setSelectedProjectId(value);
          setSelectedTopicId("");
        }}
        onTopicChange={(value) => {
          setSelectedTopicId(value);
        }}
        onSearchChange={setSearch}
        onSortChange={(value) => setSortBy(value as SortOption)}
        onHideDismissedChange={setHideDismissed}
        onHideExpiredChange={setHideExpired}
        onRematch={() => rematchMutation.mutate(selectedClientId)}
      />

      {selectedClientId ? (
        <div className="grid gap-4 md:grid-cols-3">
          <StatsCard
            title="Wszystkie dopasowania"
            value={total}
            caption="Łącznie po wybranych filtrach klienta"
            icon={BarChart3}
            tone="bg-gradient-to-br from-slate-700 via-slate-800 to-slate-900"
          />
          <StatsCard
            title="Shortlista"
            value={shortlisted}
            caption={`Status ${MATCH_STATUS_LABELS.SHORTLISTED}`}
            icon={Target}
            tone="bg-gradient-to-br from-cyan-500 via-blue-500 to-indigo-600"
          />
          <StatsCard
            title="Odrzucone"
            value={dismissed}
            caption={`Status ${MATCH_STATUS_LABELS.DISMISSED}`}
            icon={XCircle}
            tone="bg-gradient-to-br from-rose-500 via-orange-500 to-amber-500"
          />
        </div>
      ) : null}

      {!selectedClientId ? (
        <EmptyState
          title="Wybierz klienta, aby zobaczyć dopasowania"
          description="Wybierz klienta z listy powyżej, aby przejrzeć znalezione dla niego oferty przetargowe."
        />
      ) : matchesQuery.isLoading ? (
        <div className="grid gap-6">
          <Card className="h-[400px] animate-pulse rounded-[28px] border border-primary/10 bg-card/70" />
          <Card className="h-[400px] animate-pulse rounded-[28px] border border-primary/10 bg-card/70" />
        </div>
      ) : displayedMatches.length === 0 ? (
        <EmptyState
          title={search ? "Brak wyników dla wyszukiwania" : "Brak dopasowań do pokazania"}
          description={
            search
              ? `Nie znaleziono ogłoszeń pasujących do frazy „${search}”. Zmień filtry lub wyczyść wyszukiwanie.`
              : hideDismissed
                ? "Po aktywnych filtrach nic nie zostało. Spróbuj pokazać odrzucone lub oferty po terminie."
                : "Ten klient nie ma jeszcze dopasowań w aktualnym zakresie projektu i tematu."
          }
        />
      ) : (
        <div className="grid gap-8">
          <div className="flex flex-wrap items-center justify-between gap-3 px-1">
            <div>
              <p className="text-sm font-medium text-primary">{selectedClient?.companyName ?? "Klient"}</p>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">Znalezione oferty</h1>
            </div>
            <Badge variant="outline" className="rounded-full px-3 py-1 text-xs">
              {displayedMatches.length} aktywnych ofert
            </Badge>
          </div>

          <div className="grid gap-8">
            {displayedMatches.map((match) => (
              <FeaturedMatchCard
                key={match.id}
                match={match}
                statusPending={statusMutation.isPending && statusMutation.variables?.matchId === match.id}
                onStatusChange={(status) => {
                  statusMutation.mutate({
                    matchId: match.id,
                    status,
                  });
                }}
                onOpenDetails={() => setDetailMatch(match)}
                onOpenReport={() => setReportTarget(toReportAnnouncement(match))}
              />
            ))}
          </div>
        </div>
      )}

      <MatchDetailSheet
        match={detailMatch}
        open={Boolean(detailMatch)}
        onOpenChange={(open) => {
          if (!open) {
            setDetailMatch(null);
          }
        }}
      />

      <AnnouncementReportDialog
        announcement={reportTarget}
        open={Boolean(reportTarget)}
        onClose={() => setReportTarget(null)}
        allowGeneration={false}
        emptyStateMessage={
          <>
            Brak raportu dla tego ogłoszenia.
            <br />
            Samo dopasowanie mogło jednak zostać wyliczone na podstawie embeddingu i `searchContext`, nawet jeśli raport nie został jeszcze zapisany.
          </>
        }
      />
    </div>
  );
}
