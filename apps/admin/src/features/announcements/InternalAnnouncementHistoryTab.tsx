import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import { pl } from "date-fns/locale";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useDebounce } from "@/lib/use-debounce";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { addInternalAnnouncementChatComment, fetchInternalAnnouncementChat, fetchInternalAnnouncementChats } from "./announcements-api";

const CHAT_PAGE_SIZE = 50;

const FIELD_LABELS: Record<string, string> = {
  title: "Tytuł",
  contractingAuthority: "Zamawiający",
  location: "Lokalizacja",
  scope: "Zakres",
  requirements: "Wymagania",
  timeline: "Terminy",
  budget: "Budżet",
};

export function InternalAnnouncementHistoryTab() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const debouncedSearch = useDebounce(search, 300);

  const chatsQuery = useQuery({
    queryKey: ["internal-announcement-chats", debouncedSearch],
    queryFn: () =>
      fetchInternalAnnouncementChats({
        search: debouncedSearch,
        page: 1,
        limit: CHAT_PAGE_SIZE,
      }),
  });

  const chats = chatsQuery.data?.data ?? [];
  const activeChatId = useMemo(() => {
    if (selectedId && chats.some((chat) => chat.id === selectedId)) return selectedId;
    return chats[0]?.id ?? null;
  }, [chats, selectedId]);

  const chatDetailQuery = useQuery({
    queryKey: ["internal-announcement-chat", activeChatId],
    queryFn: () => fetchInternalAnnouncementChat(activeChatId!),
    enabled: Boolean(activeChatId),
  });

  const detail = chatDetailQuery.data?.data ?? null;

  const addCommentMutation = useMutation({
    mutationFn: (payload: { id: string; content: string }) =>
      addInternalAnnouncementChatComment(payload.id, payload.content),
    onSuccess: (response) => {
      setComment("");
      void queryClient.invalidateQueries({ queryKey: ["internal-announcement-chats"] });
      void queryClient.invalidateQueries({ queryKey: ["internal-announcement-chat", response.data.id] });
      toast.success("Komentarz został zapisany");
    },
    onError: () => toast.error("Nie udało się zapisać komentarza"),
  });

  function handleAddComment() {
    const value = comment.trim();
    if (!activeChatId || !value || addCommentMutation.isPending) return;
    addCommentMutation.mutate({ id: activeChatId, content: value });
  }

  const collectedEntries = Object.entries(detail?.collectedData ?? {}).filter(([, value]) => value != null && value !== "");

  return (
    <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
      <Card className="min-h-[680px]">
        <CardHeader className="border-b">
          <CardTitle>Historia czatów</CardTitle>
          <CardDescription>
            Archiwum zakończonych rozmów AI dla ogłoszeń wewnętrznych.
          </CardDescription>
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Szukaj po tytule, zakresie albo treści rozmowy"
          />
        </CardHeader>
        <CardContent className="px-0">
          <ScrollArea className="h-[560px]">
            <div className="space-y-2 px-4 pb-4">
              {chats.map((chat) => {
                const active = chat.id === activeChatId;
                return (
                  <button
                    key={chat.id}
                    type="button"
                    onClick={() => setSelectedId(chat.id)}
                    className={cn(
                      "w-full rounded-xl border p-3 text-left transition-colors",
                      active ? "border-primary bg-primary/5" : "hover:bg-muted/50",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="line-clamp-2 font-medium">{chat.title}</div>
                        {chat.description ? (
                          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                            {chat.description}
                          </p>
                        ) : null}
                      </div>
                      <Badge variant="secondary">{chat.commentCount}</Badge>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <span>{chat.messageCount} wiadomości</span>
                      <span>{chat.commentCount} komentarzy</span>
                      <span>
                        {formatDistanceToNow(new Date(chat.createdAt), { addSuffix: true, locale: pl })}
                      </span>
                    </div>

                    {chat.lastMessagePreview ? (
                      <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                        {chat.lastMessagePreview}
                      </p>
                    ) : null}
                  </button>
                );
              })}

              {!chatsQuery.isLoading && chats.length === 0 && (
                <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                  Brak archiwalnych czatów dla podanych kryteriów.
                </div>
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      <Card className="min-h-[680px]">
        <CardHeader className="border-b">
          <CardTitle>{detail?.title ?? "Wybierz czat z listy"}</CardTitle>
          <CardDescription>
            {detail
              ? `Utworzono ${format(new Date(detail.createdAt), "dd.MM.yyyy HH:mm")}`
              : "Po prawej zobaczysz przebieg rozmowy i dodasz komentarze do poprawy działania asystenta."}
          </CardDescription>
        </CardHeader>

        {detail ? (
          <CardContent className="grid gap-4 py-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-4">
              {collectedEntries.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {collectedEntries.map(([key, value]) => (
                    <Badge key={key} variant="secondary" className="gap-1 whitespace-normal py-1">
                      <span className="font-medium">{FIELD_LABELS[key] ?? key}:</span>
                      <span>{String(value)}</span>
                    </Badge>
                  ))}
                </div>
              )}

              <div className="rounded-xl border">
                <div className="border-b px-4 py-3 text-sm font-medium">Przebieg rozmowy</div>
                <ScrollArea className="h-[420px]">
                  <div className="space-y-4 px-4 py-4">
                    {detail.conversation.map((message, index) => (
                      <div
                        key={`${message.role}-${index}`}
                        className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}
                      >
                        <div
                          className={cn(
                            "max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-relaxed",
                            message.role === "user"
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-foreground",
                          )}
                        >
                          {message.content}
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>

              {detail.detailedReport ? (
                <div className="rounded-xl border">
                  <div className="border-b px-4 py-3 text-sm font-medium">Zapisane ogłoszenie</div>
                  <ScrollArea className="h-[220px]">
                    <div className="whitespace-pre-wrap px-4 py-4 text-sm leading-relaxed">
                      {detail.detailedReport}
                    </div>
                  </ScrollArea>
                </div>
              ) : null}
            </div>

            <div className="space-y-4">
              <div className="rounded-xl border p-4">
                <p className="text-sm font-medium">Komentarze do poprawy działania</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Zapisz uwagi typu: co było nietrafione, co AI pominęło albo jak powinno dopytać następnym razem.
                </p>

                <textarea
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  placeholder="Np. AI za szybko uznało zakres za kompletny i powinno dopytać o integracje oraz SLA."
                  className="mt-3 min-h-32 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                />

                <div className="mt-3 flex justify-end">
                  <Button
                    onClick={handleAddComment}
                    disabled={!comment.trim() || addCommentMutation.isPending}
                  >
                    {addCommentMutation.isPending ? "Zapisywanie…" : "Dodaj komentarz"}
                  </Button>
                </div>
              </div>

              <div className="rounded-xl border">
                <div className="border-b px-4 py-3 text-sm font-medium">
                  Zapisane komentarze ({detail.feedbackComments.length})
                </div>
                <ScrollArea className="h-[320px]">
                  <div className="space-y-3 px-4 py-4">
                    {detail.feedbackComments.map((item) => (
                      <div key={item.id} className="rounded-xl bg-muted/50 p-3 text-sm">
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span>{item.authorName ?? item.authorEmail ?? "Admin"}</span>
                          <span>•</span>
                          <span>{formatDistanceToNow(new Date(item.createdAt), { addSuffix: true, locale: pl })}</span>
                        </div>
                        <p className="mt-2 whitespace-pre-wrap leading-relaxed">{item.content}</p>
                      </div>
                    ))}

                    {detail.feedbackComments.length === 0 && (
                      <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                        Brak komentarzy do tego czatu.
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </div>
            </div>
          </CardContent>
        ) : (
          <CardContent className="py-12 text-sm text-muted-foreground">
            {chatsQuery.isLoading ? "Ładowanie historii czatów…" : "Wybierz czat z lewej strony."}
          </CardContent>
        )}
      </Card>
    </div>
  );
}