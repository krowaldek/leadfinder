import { cn } from "@/lib/utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Announcement } from "@leadfinder/contracts";
import { sendInternalAnnouncementPromptMessage } from "./announcements-api";

const CONFIRM_CREATE_MESSAGE = "__CONFIRM_INTERNAL_ANNOUNCEMENT__";

interface Message {
  role: "user" | "assistant";
  text: string;
}

const INITIAL_MESSAGE: Message = {
  role: "assistant",
  text: "Cześć! Opisz, jakiego ogłoszenia wewnętrznego potrzebujesz, a ja dopytam o brakujące szczegóły tak, żeby wykonawca mógł to sensownie wycenić. Jeśli temat dotyczy montażu albo prac na miejscu, mogę też podpowiedzieć, że przydadzą się zdjęcia, szkic albo inspiracje.",
};

const FIELD_LABELS: Record<string, string> = {
  title: "Tytuł",
  contractingAuthority: "Zamawiający",
  location: "Lokalizacja",
  scope: "Zakres",
  requirements: "Wymagania",
  timeline: "Terminy",
  budget: "Budżet",
};

function CollectedDataBadges({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data).filter(([, value]) => value != null && value !== "");
  if (entries.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 border-b px-4 py-4">
      {entries.map(([key, value]) => (
        <Badge key={key} variant="secondary" className="gap-1">
          <span className="font-medium">{FIELD_LABELS[key] ?? key}:</span>
          <span>{String(value)}</span>
        </Badge>
      ))}
    </div>
  );
}

interface InternalAnnouncementPromptPanelProps {
  onCreated?: (announcement: Announcement) => void;
}

export function InternalAnnouncementPromptPanel({ onCreated }: InternalAnnouncementPromptPanelProps) {
  const queryClient = useQueryClient();
  const bottomRef = useRef<HTMLDivElement>(null);
  const [messages, setMessages] = useState<Message[]>([INITIAL_MESSAGE]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const [collectedData, setCollectedData] = useState<Record<string, unknown>>({});
  const [createdAnnouncement, setCreatedAnnouncement] = useState<Announcement | null>(null);
  const [reviewPending, setReviewPending] = useState(false);

  const sendMutation = useMutation({
    mutationFn: (message: string) => sendInternalAnnouncementPromptMessage(sessionId, message),
    onMutate: (message) => {
      setMessages((previous) => [...previous, { role: "user", text: message }]);
      setInput("");
    },
    onSuccess: (result) => {
      if (result.status === "question") {
        setSessionId(result.sessionId);
        setCollectedData(result.collectedData as Record<string, unknown>);
        setReviewPending(false);
        setMessages((previous) => [...previous, { role: "assistant", text: result.question }]);
      } else if (result.status === "review") {
        setSessionId(result.sessionId);
        setCollectedData(result.collectedData as Record<string, unknown>);
        setReviewPending(true);
        setMessages((previous) => [...previous, { role: "assistant", text: result.summary }]);
      } else {
        setCreatedAnnouncement(result.announcement);
        setReviewPending(false);
        setMessages((previous) => [
          ...previous,
          {
            role: "assistant",
            text: "Gotowe — ogłoszenie zostało zapisane i trafiło do tego samego pipeline'u embeddingu oraz dopasowań co ogłoszenia ze scraperów.",
          },
        ]);
        void queryClient.invalidateQueries({ queryKey: ["announcements"] });
        void queryClient.invalidateQueries({ queryKey: ["internal-announcement-chats"] });
        toast.success("Ogłoszenie wewnętrzne zostało utworzone");
        onCreated?.(result.announcement);
      }

      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    },
    onError: (error: unknown) => {
      const apiMessage =
        (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
      const label = apiMessage ?? "Nie udało się przetworzyć wiadomości";
      toast.error(label);
      setMessages((previous) => [...previous, { role: "assistant", text: `⚠️ ${label}` }]);
    },
  });

  function resetConversation() {
    setMessages([INITIAL_MESSAGE]);
    setInput("");
    setSessionId(undefined);
    setCollectedData({});
    setCreatedAnnouncement(null);
    setReviewPending(false);
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const message = input.trim();
    if (!message || sendMutation.isPending) return;
    sendMutation.mutate(message);
  }

  function handleConfirmCreate() {
    if (!sessionId || sendMutation.isPending) return;
    sendMutation.mutate(CONFIRM_CREATE_MESSAGE);
  }

  return (
    <div className="flex min-h-[560px] flex-col rounded-xl border bg-background">
      <CollectedDataBadges data={collectedData} />

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {messages.map((message, index) => (
          <div
            key={index}
            className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}
          >
            {message.role === "assistant" && (
              <div className="mr-2 mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                AI
              </div>
            )}
            <div
              className={cn(
                "max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-relaxed",
                message.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-foreground",
              )}
            >
              {message.text}
            </div>
          </div>
        ))}

        {sendMutation.isPending && (
          <div className="flex justify-start">
            <div className="mr-2 mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
              AI
            </div>
            <div className="rounded-2xl bg-muted px-4 py-3 text-sm">
              <span className="flex items-center gap-1">
                {[0, 1, 2].map((index) => (
                  <span
                    key={index}
                    className="size-1.5 animate-pulse rounded-full bg-muted-foreground"
                    style={{ animationDelay: `${index * 200}ms` }}
                  />
                ))}
              </span>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {createdAnnouncement && (
        <div className="flex justify-center gap-3 border-t px-4 py-3">
          <Button onClick={() => onCreated?.(createdAnnouncement)}>Pokaż raport</Button>
          <Button variant="outline" onClick={resetConversation}>Dodaj kolejne ogłoszenie</Button>
        </div>
      )}

      {!createdAnnouncement && (
        <form onSubmit={handleSubmit} className="border-t px-4 py-3">
          <div className="flex gap-2">
            <Input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={reviewPending
                ? "Np. zmień termin na koniec maja albo dopisz warunek SLA…"
                : "Np. szukamy wykonawcy wdrożenia CRM dla 40 handlowców…"}
              disabled={sendMutation.isPending}
            />
            <Button type="submit" disabled={!input.trim() || sendMutation.isPending}>
              {reviewPending ? "Popraw" : "Wyślij"}
            </Button>
            {reviewPending && (
              <Button type="button" onClick={handleConfirmCreate} disabled={sendMutation.isPending}>
                Utwórz ogłoszenie
              </Button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}