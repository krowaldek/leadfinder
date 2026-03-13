import { useParams, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronRight,
  Cpu,
  FileSearch,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  announcementKindSchema,
  createProjectSchema,
  createTopicSchema,
  topicMatchingProfileSchema,
  updateProjectSchema,
  updateTopicSchema,
  type AnnouncementKind,
  type CreateProject,
  type CreateTopic,
  type ProjectListItem,
  type TopicMatchingProfile,
  type Topic,
  type UpdateProject,
  type UpdateTopic,
} from "@leadfinder/contracts";
import {
  createProject,
  createTopic,
  deleteProject,
  deleteTopic,
  embedTopic,
  fetchClient,
  fetchProjects,
  fetchTopics,
  generateTopicPrompt,
  rematchClient,
  updateProject,
  updateTopic,
} from "./clients-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EMBEDDING_STATUS_LABELS: Record<string, string> = {
  PENDING: "Oczekuje",
  EMBEDDED: "Zagnieżdżone",
  ERROR: "Błąd",
};

const ANNOUNCEMENT_KIND_LABELS: Record<AnnouncementKind, string> = {
  DOSTAWA: "Dostawa",
  USLUGA: "Usługa",
  ROBOTY_BUDOWLANE: "Roboty bud.",
  SZKOLENIE: "Szkolenie",
  USLUGA_IT: "Usługi IT",
  USLUGA_BADAWCZO_ROZWOJOWA: "B+R",
  DORADZTWO: "Doradztwo",
  INNE: "Inne",
};

const ANNOUNCEMENT_KIND_OPTIONS = announcementKindSchema.options;

type BadgeVariant = "default" | "secondary" | "outline" | "destructive";

function embeddingStatusVariant(status: string): BadgeVariant {
  if (status === "EMBEDDED") return "default";
  if (status === "ERROR") return "destructive";
  return "outline"; // PENDING
}

// ---------------------------------------------------------------------------
// KeywordInput — tag input for negativeKeywords
// ---------------------------------------------------------------------------

function KeywordInput({
  value,
  onChange,
}: {
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [input, setInput] = useState("");

  function addKeyword() {
    const trimmed = input.trim().toLowerCase();
    if (trimmed && !value.includes(trimmed)) {
      onChange([...value, trimmed]);
    }
    setInput("");
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addKeyword();
            }
          }}
          placeholder="Wpisz słowo i naciśnij Enter…"
        />
        <Button type="button" variant="outline" size="sm" onClick={addKeyword}>
          Dodaj
        </Button>
      </div>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((kw) => (
            <Badge key={kw} variant="secondary" className="gap-1 pr-1">
              {kw}
              <button
                type="button"
                onClick={() => onChange(value.filter((k) => k !== kw))}
                className="ml-0.5 rounded hover:text-destructive"
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

function normalizeMatchingProfile(profile: Partial<TopicMatchingProfile> | null | undefined) {
  return topicMatchingProfileSchema.parse({
    summary: profile?.summary?.trim() || "Krótki opis zakresu szukanych zamówień.",
    mustHave: profile?.mustHave ?? [],
    niceToHave: profile?.niceToHave ?? [],
    exclude: profile?.exclude ?? [],
    expectedKinds: profile?.expectedKinds ?? [],
  });
}

// ---------------------------------------------------------------------------
// DeleteConfirmDialog
// ---------------------------------------------------------------------------

function DeleteConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  onConfirm,
  isPending,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description: string;
  onConfirm: () => void;
  isPending: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{description}</p>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Anuluj
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={isPending}
          >
            {isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
            Usuń
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// ProjectDialog — create / edit project
// ---------------------------------------------------------------------------

function ProjectDialog({
  open,
  onOpenChange,
  clientId,
  project,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clientId: string;
  project: ProjectListItem | null;
}) {
  const queryClient = useQueryClient();
  const schema = project ? updateProjectSchema : createProjectSchema;

  const form = useForm<CreateProject | UpdateProject>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(schema as any),
    defaultValues: {
      name: project?.name ?? "",
      description: project?.description ?? "",
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: CreateProject) => createProject(clientId, data),
    onSuccess: () => {
      toast.success("Projekt został dodany");
      void queryClient.invalidateQueries({ queryKey: ["projects", clientId] });
      onOpenChange(false);
    },
    onError: () => toast.error("Nie udało się dodać projektu"),
  });

  const updateMutation = useMutation({
    mutationFn: (data: UpdateProject) =>
      updateProject(clientId, project!.id, data),
    onSuccess: () => {
      toast.success("Projekt został zaktualizowany");
      void queryClient.invalidateQueries({ queryKey: ["projects", clientId] });
      onOpenChange(false);
    },
    onError: () => toast.error("Nie udało się zaktualizować projektu"),
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

  function onSubmit(values: CreateProject | UpdateProject) {
    if (project) {
      updateMutation.mutate(values as UpdateProject);
    } else {
      createMutation.mutate(values as CreateProject);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {project ? "Edytuj projekt" : "Nowy projekt"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="project-name">Nazwa projektu *</Label>
            <Input
              id="project-name"
              {...form.register("name")}
              placeholder="np. Zamówienia IT 2025"
            />
            {form.formState.errors.name && (
              <p className="text-xs text-destructive">
                {form.formState.errors.name.message}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="project-desc">Opis</Label>
            <textarea
              id="project-desc"
              {...form.register("description")}
              placeholder="Opcjonalny opis projektu…"
              rows={3}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Anuluj
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
              {project ? "Zapisz" : "Dodaj projekt"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// TopicDialog — create / edit topic
// ---------------------------------------------------------------------------

function TopicDialog({
  open,
  onOpenChange,
  clientId,
  projectId,
  topic,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clientId: string;
  projectId: string;
  topic: Topic | null;
}) {
  const queryClient = useQueryClient();
  const schema = topic ? updateTopicSchema : createTopicSchema;
  const [isGenerating, setIsGenerating] = useState(false);

  const form = useForm<CreateTopic | UpdateTopic>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(schema as any),
    defaultValues: {
      title: topic?.title ?? "",
      prompt: topic?.matchingProfile?.summary ?? topic?.prompt ?? "",
      negativeKeywords: topic?.matchingProfile?.exclude ?? topic?.negativeKeywords ?? [],
      matchingProfile: normalizeMatchingProfile(
        topic?.matchingProfile ?? {
          summary: topic?.prompt ?? "Krótki opis zakresu szukanych zamówień.",
          exclude: topic?.negativeKeywords ?? [],
        },
      ),
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: CreateTopic) => createTopic(clientId, projectId, data),
    onSuccess: () => {
      toast.success("Temat dodany — embedding w kolejce");
      void queryClient.invalidateQueries({
        queryKey: ["topics", clientId, projectId],
      });
      void queryClient.invalidateQueries({ queryKey: ["projects", clientId] });
      onOpenChange(false);
    },
    onError: () => toast.error("Nie udało się dodać tematu"),
  });

  const updateMutation = useMutation({
    mutationFn: (data: UpdateTopic) =>
      updateTopic(clientId, projectId, topic!.id, data),
    onSuccess: () => {
      toast.success("Temat zaktualizowany");
      void queryClient.invalidateQueries({
        queryKey: ["topics", clientId, projectId],
      });
      onOpenChange(false);
    },
    onError: () => toast.error("Nie udało się zaktualizować tematu"),
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

  async function handleGeneratePrompt() {
    const title = (form.getValues("title") ?? "").trim();
    if (!title) {
      toast.error("Wpisz najpierw tytuł tematu");
      return;
    }
    setIsGenerating(true);
    try {
      const result = await generateTopicPrompt(clientId, title);
      form.setValue("prompt", result.prompt, { shouldValidate: true, shouldDirty: true });
      form.setValue("matchingProfile", result.matchingProfile, {
        shouldValidate: true,
        shouldDirty: true,
      });
      form.setValue("negativeKeywords", result.matchingProfile.exclude, {
        shouldValidate: true,
        shouldDirty: true,
      });
      toast.success("Prompt wygenerowany przez AI");
    } catch {
      toast.error("Nie udało się wygenerować promptu");
    } finally {
      setIsGenerating(false);
    }
  }

  function onSubmit(values: CreateTopic | UpdateTopic) {
    const nextProfile = normalizeMatchingProfile({
      ...values.matchingProfile,
      summary: values.prompt?.trim() || values.matchingProfile?.summary || "",
      exclude: values.matchingProfile?.exclude ?? values.negativeKeywords ?? [],
    });

    const payload = {
      ...values,
      prompt: nextProfile.summary,
      matchingProfile: nextProfile,
      negativeKeywords: nextProfile.exclude,
    } satisfies CreateTopic | UpdateTopic;

    if (topic) {
      updateMutation.mutate(payload as UpdateTopic);
    } else {
      createMutation.mutate(payload as CreateTopic);
    }
  }

  const matchingProfile = normalizeMatchingProfile(form.watch("matchingProfile"));

  function setProfileValue<K extends keyof TopicMatchingProfile>(
    key: K,
    value: TopicMatchingProfile[K],
  ) {
    form.setValue(`matchingProfile.${key}` as never, value as never, {
      shouldValidate: true,
      shouldDirty: true,
    });

    if (key === "exclude") {
      form.setValue("negativeKeywords", value as string[], {
        shouldValidate: true,
        shouldDirty: true,
      });
    }
  }

  function toggleExpectedKind(kind: AnnouncementKind) {
    const current = matchingProfile.expectedKinds;
    const next = current.includes(kind)
      ? current.filter((item) => item !== kind)
      : [...current, kind];
    setProfileValue("expectedKinds", next);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{topic ? "Edytuj temat" : "Nowy temat"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="topic-title">Tytuł *</Label>
            <Input
              id="topic-title"
              {...form.register("title")}
              placeholder="np. Szkolenia e-learning"
            />
            {form.formState.errors.title && (
              <p className="text-xs text-destructive">
                {form.formState.errors.title.message}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="topic-prompt">Prompt / opis tematu *</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
                onClick={handleGeneratePrompt}
                disabled={isGenerating || isPending}
              >
                {isGenerating ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Sparkles className="size-3" />
                )}
                Wygeneruj AI
              </Button>
            </div>
            <textarea
              id="topic-prompt"
              {...form.register("prompt")}
              placeholder="Opisz konkretny zakres wyszukiwania — co dokładnie ma być przedmiotem zamówienia, dla kogo i w jakim kontekście."
              rows={6}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
            />
            {form.formState.errors.prompt && (
              <p className="text-xs text-destructive">
                {form.formState.errors.prompt.message}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Frazy obowiązkowe</Label>
            <p className="text-xs text-muted-foreground">
              Bez tych fraz oferta nie powinna być uznana za sensownie dopasowaną.
            </p>
            <KeywordInput
              value={matchingProfile.mustHave}
              onChange={(v) => setProfileValue("mustHave", v)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Frazy mile widziane</Label>
            <p className="text-xs text-muted-foreground">
              Dodatkowe sygnały podbijające wynik, ale nieobowiązkowe.
            </p>
            <KeywordInput
              value={matchingProfile.niceToHave}
              onChange={(v) => setProfileValue("niceToHave", v)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Frazy wykluczające</Label>
            <p className="text-xs text-muted-foreground">
              Typowe błędne skojarzenia i branże, które mają odpadać z dopasowań.
            </p>
            <KeywordInput
              value={matchingProfile.exclude}
              onChange={(v) => setProfileValue("exclude", v)}
            />
          </div>
          <div className="space-y-2">
            <Label>Preferowane typy zamówień</Label>
            <p className="text-xs text-muted-foreground">
              Zawęża dopasowanie do realnych kategorii ogłoszeń.
            </p>
            <div className="flex flex-wrap gap-2">
              {ANNOUNCEMENT_KIND_OPTIONS.map((kind) => {
                const active = matchingProfile.expectedKinds.includes(kind);
                return (
                  <Button
                    key={kind}
                    type="button"
                    size="sm"
                    variant={active ? "default" : "outline"}
                    onClick={() => toggleExpectedKind(kind)}
                  >
                    {ANNOUNCEMENT_KIND_LABELS[kind]}
                  </Button>
                );
              })}
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Anuluj
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
              {topic ? "Zapisz" : "Dodaj temat"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// TopicRow
// ---------------------------------------------------------------------------

function TopicRow({
  topic,
  clientId,
  projectId,
}: {
  topic: Topic;
  clientId: string;
  projectId: string;
}) {
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);

  const deleteMutation = useMutation({
    mutationFn: () => deleteTopic(clientId, projectId, topic.id),
    onSuccess: () => {
      toast.success("Temat usunięty");
      void queryClient.invalidateQueries({
        queryKey: ["topics", clientId, projectId],
      });
      void queryClient.invalidateQueries({ queryKey: ["projects", clientId] });
      setDeleteOpen(false);
    },
    onError: () => toast.error("Nie udało się usunąć tematu"),
  });

  const embedMutation = useMutation({
    mutationFn: () => embedTopic(clientId, projectId, topic.id),
    onSuccess: () => {
      toast.success("Embedding zakolejkowany");
      void queryClient.invalidateQueries({
        queryKey: ["topics", clientId, projectId],
      });
    },
    onError: () => toast.error("Nie udało się zakolejkować embeddingu"),
  });

  return (
    <>
      <div className="rounded-md border text-sm">
        {/* Header row */}
        <div className="flex items-center justify-between px-3 py-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="truncate font-medium">{topic.title}</span>
            <Badge variant={embeddingStatusVariant(topic.embeddingStatus)} className="shrink-0">
              {EMBEDDING_STATUS_LABELS[topic.embeddingStatus] ?? topic.embeddingStatus}
            </Badge>
            {topic.matchCount > 0 && (
              <Badge variant="secondary" className="shrink-0">{topic.matchCount} dopasowań</Badge>
            )}
          </div>
          <div className="ml-3 flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 px-2 text-xs"
              title="Prze-wektoryzuj ten temat (krok 1: embedding)"
              onClick={() => embedMutation.mutate()}
              disabled={embedMutation.isPending}
            >
              {embedMutation.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Cpu className="size-3.5" />
              )}
              Wektoryzuj
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              title="Edytuj temat"
              onClick={() => setEditOpen(true)}
            >
              <Pencil className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-destructive hover:text-destructive"
              title="Usuń temat"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        </div>
        {/* Prompt preview */}
        {topic.prompt && (
          <div className="border-t bg-muted/30 px-3 py-2">
            <p className="mb-1 text-xs text-muted-foreground/70">Opis wyszukiwania</p>
            <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">
              {topic.prompt}
            </p>
            {topic.matchingProfile?.mustHave?.length ? (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {topic.matchingProfile.mustHave.map((term) => (
                  <Badge key={term} variant="secondary" className="text-[10px] py-0">
                    + {term}
                  </Badge>
                ))}
              </div>
            ) : null}
            {topic.negativeKeywords.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {topic.negativeKeywords.map((kw) => (
                  <Badge key={kw} variant="outline" className="text-[10px] py-0">– {kw}</Badge>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <TopicDialog
        key={`edit-topic-${topic.id}`}
        open={editOpen}
        onOpenChange={setEditOpen}
        clientId={clientId}
        projectId={projectId}
        topic={topic}
      />

      <DeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Usuń temat"
        description={`Czy na pewno chcesz usunąć temat „${topic.title}"? Ta akcja jest nieodwracalna.`}
        onConfirm={() => deleteMutation.mutate()}
        isPending={deleteMutation.isPending}
      />
      <Dialog open={promptOpen} onOpenChange={setPromptOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Opis tematu — {topic.title}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Opis wyszukiwania</p>
            <div className="rounded-md border bg-muted/40 p-4">
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{topic.prompt}</p>
            </div>
            {topic.matchingProfile?.mustHave?.length ? (
              <>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Frazy obowiązkowe</p>
                <div className="flex flex-wrap gap-1.5">
                  {topic.matchingProfile.mustHave.map((term) => (
                    <Badge key={term} variant="secondary" className="text-xs">{term}</Badge>
                  ))}
                </div>
              </>
            ) : null}
            {topic.matchingProfile?.niceToHave?.length ? (
              <>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Frazy mile widziane</p>
                <div className="flex flex-wrap gap-1.5">
                  {topic.matchingProfile.niceToHave.map((term) => (
                    <Badge key={term} variant="outline" className="text-xs">{term}</Badge>
                  ))}
                </div>
              </>
            ) : null}
            {topic.matchingProfile?.expectedKinds?.length ? (
              <>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Preferowane typy</p>
                <div className="flex flex-wrap gap-1.5">
                  {topic.matchingProfile.expectedKinds.map((kind) => (
                    <Badge key={kind} variant="outline" className="text-xs">
                      {ANNOUNCEMENT_KIND_LABELS[kind]}
                    </Badge>
                  ))}
                </div>
              </>
            ) : null}
            {topic.negativeKeywords.length > 0 && (
              <>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Frazy wykluczające</p>
                <div className="flex flex-wrap gap-1.5">
                  {topic.negativeKeywords.map((kw) => (
                    <Badge key={kw} variant="outline" className="text-xs">{kw}</Badge>
                  ))}
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// ProjectCard
// ---------------------------------------------------------------------------

function ProjectCard({
  project,
  clientId,
}: {
  project: ProjectListItem;
  clientId: string;
}) {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [newTopicOpen, setNewTopicOpen] = useState(false);

  const topicsQuery = useQuery({
    queryKey: ["topics", clientId, project.id],
    queryFn: () => fetchTopics(clientId, project.id),
    enabled: isOpen,
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteProject(clientId, project.id),
    onSuccess: () => {
      toast.success("Projekt usunięty");
      void queryClient.invalidateQueries({ queryKey: ["projects", clientId] });
      setDeleteOpen(false);
    },
    onError: () => toast.error("Nie udało się usunąć projektu"),
  });

  const topics = topicsQuery.data?.data ?? [];

  return (
    <>
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
              onClick={() => setIsOpen((v) => !v)}
            >
              {isOpen ? (
                <ChevronDown className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              )}
              <div className="min-w-0">
                <CardTitle className="text-base">{project.name}</CardTitle>
                {project.description && (
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {project.description}
                  </p>
                )}
              </div>
              <Badge variant="outline" className="ml-auto shrink-0">
                {project.topicCount}{" "}
                {project.topicCount === 1 ? "temat" : "tematów"}
              </Badge>
            </button>

            <div className="flex shrink-0 items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                title="Edytuj projekt"
                onClick={() => setEditOpen(true)}
              >
                <Pencil className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-destructive hover:text-destructive"
                title="Usuń projekt"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          </div>
        </CardHeader>

        {isOpen && (
          <CardContent className="pt-0">
            <div className="space-y-2 border-t pt-3">
              {topicsQuery.isLoading && (
                <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Ładowanie tematów…
                </div>
              )}

              {!topicsQuery.isLoading && topics.length === 0 && (
                <p className="py-2 text-sm text-muted-foreground">
                  Brak tematów. Dodaj pierwszy temat.
                </p>
              )}

              {topics.map((t) => (
                <TopicRow
                  key={t.id}
                  topic={t}
                  clientId={clientId}
                  projectId={project.id}
                />
              ))}

              <Button
                variant="outline"
                size="sm"
                className="mt-1 w-full"
                onClick={() => setNewTopicOpen(true)}
              >
                <Plus className="mr-1.5 size-3.5" />
                Nowy temat
              </Button>
            </div>
          </CardContent>
        )}
      </Card>

      <ProjectDialog
        key={`edit-project-${project.id}`}
        open={editOpen}
        onOpenChange={setEditOpen}
        clientId={clientId}
        project={project}
      />

      <TopicDialog
        key={`new-topic-${project.id}`}
        open={newTopicOpen}
        onOpenChange={setNewTopicOpen}
        clientId={clientId}
        projectId={project.id}
        topic={null}
      />

      <DeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Usuń projekt"
        description={`Czy na pewno chcesz usunąć projekt „${project.name}" wraz ze wszystkimi tematami i dopasowaniami?`}
        onConfirm={() => deleteMutation.mutate()}
        isPending={deleteMutation.isPending}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// ClientDetailPage
// ---------------------------------------------------------------------------

export function ClientDetailPage() {
  const { clientId } = useParams({ strict: false }) as { clientId: string };
  const [newProjectOpen, setNewProjectOpen] = useState(false);

  const clientQuery = useQuery({
    queryKey: ["client", clientId],
    queryFn: () => fetchClient(clientId),
  });

  const projectsQuery = useQuery({
    queryKey: ["projects", clientId],
    queryFn: () => fetchProjects(clientId),
  });

  const rematchMutation = useMutation({
    mutationFn: () => rematchClient(clientId),
    onSuccess: () => toast.success("Przeliczanie dopasowań zakolejkowane (wszystkie tematy)"),
    onError: () => toast.error("Nie udało się zakolejkować przeliczania"),
  });

  const client = clientQuery.data;
  const projects = projectsQuery.data?.data ?? [];

  if (clientQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Ładowanie klienta…
      </div>
    );
  }

  if (clientQuery.isError || !client) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-destructive">Nie udało się załadować klienta.</p>
        <Link to="/clients" className="text-sm underline">
          ← Wróć do listy
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link to="/clients" className="hover:text-foreground">
          Klienci
        </Link>
        <span>/</span>
        <span className="text-foreground font-medium">{client.companyName}</span>
      </nav>

      {/* Client summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">{client.companyName}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">Branża</dt>
              <dd>{client.industry}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Zasięg</dt>
              <dd>
                <Badge variant="outline">
                  {
                    { NATIONAL: "Cała Polska", REGIONAL: "Regionalny", LOCAL: "Lokalny" }[
                      client.geographicScope
                    ]
                  }
                </Badge>
                {client.geographicDetails && (
                  <span className="ml-2 text-muted-foreground">
                    {client.geographicDetails}
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Status</dt>
              <dd>
                <Badge
                  variant={client.status === "ACTIVE" ? "default" : "secondary"}
                >
                  {client.status === "ACTIVE" ? "Aktywny" : "Nieaktywny"}
                </Badge>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Osoba kontaktowa</dt>
              <dd>
                {client.contactPersonName} · {client.contactPersonRole}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Budżet</dt>
              <dd>{client.budgetDescription}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {/* Projects section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            Projekty
            {projects.length > 0 && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                ({projects.length})
              </span>
            )}
          </h2>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => rematchMutation.mutate()}
              disabled={rematchMutation.isPending}
              title="Przelicz dopasowania dla wszystkich tematów tego klienta (krok 2)"
            >
              {rematchMutation.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              Przelicz dopasowania
            </Button>
            <Button size="sm" onClick={() => setNewProjectOpen(true)}>
              <Plus className="mr-1.5 size-3.5" />
              Nowy projekt
            </Button>
          </div>
        </div>

        {projectsQuery.isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Ładowanie projektów…
          </div>
        )}

        {!projectsQuery.isLoading && projects.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              Brak projektów. Kliknij „Nowy projekt" aby dodać pierwszy.
            </CardContent>
          </Card>
        )}

        {projects.map((p) => (
          <ProjectCard key={p.id} project={p} clientId={clientId} />
        ))}
      </div>

      {/* New project dialog */}
      <ProjectDialog
        key="new-project"
        open={newProjectOpen}
        onOpenChange={setNewProjectOpen}
        clientId={clientId}
        project={null}
      />
    </div>
  );
}
