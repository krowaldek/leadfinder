import { cn } from "@/lib/utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { sendPromptMessage } from "./clients-api";
import type { ClientResponse } from "@leadfinder/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Message {
  role: "user" | "assistant";
  text: string;
}

const INITIAL_MESSAGE: Message = {
  role: "assistant",
  text: "Cześć! Jestem asystentem Leadfinder 👋\nPomogę Ci założyć profil firmy, żeby dopasować odpowiednie ogłoszenia.\n\nZacznijmy — jak nazywa się Twoja firma?",
};

function CollectedDataBadges({ data }: { data: Record<string, unknown> }) {
  const LABELS: Record<string, string> = {
    companyName: "Firma",
    industry: "Branża",
    geographicScope: "Zasięg",
    geographicDetails: "Lokalizacja",
    budgetDescription: "Budżet",
    contactPersonName: "Kontakt",
    contactPersonRole: "Rola",
  };
  const entries = Object.entries(data).filter(([, v]) => v != null && v !== "");
  if (entries.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 p-4 border-b">
      {entries.map(([k, v]) => (
        <Badge key={k} variant="secondary" className="gap-1">
          <span className="font-medium">{LABELS[k] ?? k}:</span>
          <span>{String(v)}</span>
        </Badge>
      ))}
    </div>
  );
}

export function ClientPromptPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [messages, setMessages] = useState<Message[]>([INITIAL_MESSAGE]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const [collectedData, setCollectedData] = useState<Record<string, unknown>>({});
  const [createdClient, setCreatedClient] = useState<ClientResponse | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const sendMutation = useMutation({
    mutationFn: (message: string) => sendPromptMessage(sessionId, message),
    onMutate: (message) => {
      setMessages((prev) => [...prev, { role: "user", text: message }]);
      setInput("");
    },
    onSuccess: (res) => {
      if (res.status === "question") {
        setSessionId(res.sessionId);
        setCollectedData(res.collectedData as Record<string, unknown>);
        setMessages((prev) => [...prev, { role: "assistant", text: res.question }]);
      } else {
        setCreatedClient(res.client);
        void queryClient.invalidateQueries({ queryKey: ["clients"] });
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            text: `✅ Profil firmy **${res.client.companyName}** został utworzony!\n\nGeneruję teraz syntetyczne ogłoszenie klienta i przeliczam dopasowania w tle. Za chwilę będą widoczne na stronie klientów.`,
          },
        ]);
      }
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    },
    onError: () => {
      toast.error("Błąd komunikacji z asystentem");
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: "Przepraszam, wystąpił błąd. Spróbuj ponownie." },
      ]);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || sendMutation.isPending) return;
    sendMutation.mutate(text);
  };

  return (
    <div className="flex h-[calc(100vh-280px)] min-h-[500px] flex-col rounded-lg border bg-background">
      <CollectedDataBadges data={collectedData} />

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.map((m, i) => (
          <div
            key={i}
            className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
          >
            {m.role === "assistant" && (
              <div className="mr-2 mt-1 size-7 shrink-0 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xs font-bold">
                AI
              </div>
            )}
            <div
              className={cn(
                "max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap",
                m.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-foreground",
              )}
            >
              {m.text}
            </div>
          </div>
        ))}

        {sendMutation.isPending && (
          <div className="flex justify-start">
            <div className="mr-2 mt-1 size-7 shrink-0 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xs font-bold">
              AI
            </div>
            <div className="rounded-2xl bg-muted px-4 py-3 text-sm">
              <span className="flex gap-1 items-center">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="size-1.5 rounded-full bg-muted-foreground animate-pulse"
                    style={{ animationDelay: `${i * 200}ms` }}
                  />
                ))}
              </span>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Post-creation actions */}
      {createdClient && (
        <div className="border-t px-4 py-3 flex gap-3 justify-center">
          <Button onClick={() => void navigate({ to: "/clients" })}>
            Zobacz dopasowania →
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setMessages([INITIAL_MESSAGE]);
              setSessionId(undefined);
              setCollectedData({});
              setCreatedClient(null);
              setInput("");
            }}
          >
            Dodaj kolejnego klienta
          </Button>
        </div>
      )}

      {/* Input */}
      {!createdClient && (
        <form onSubmit={handleSubmit} className="border-t px-4 py-3">
          <div className="flex gap-2">
            <Input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Napisz wiadomość…"
              disabled={sendMutation.isPending}
            />
            <Button type="submit" disabled={!input.trim() || sendMutation.isPending}>
              Wyślij
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

