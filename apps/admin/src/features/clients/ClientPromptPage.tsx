import { cn } from "@/lib/utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { motion, AnimatePresence } from "framer-motion";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { sendPromptMessage } from "./clients-api";
import type { ClientResponse } from "@leadfinder/contracts";

interface Message {
  role: "user" | "assistant";
  text: string;
}

const INITIAL_MESSAGE: Message = {
  role: "assistant",
  text: "Cześć! Jestem asystentem Leadfinder 👋\nPomogę Ci założyć profil firmy, żeby dopasować odpowiednie ogłoszenia.\n\nZacznijmy — jak nazywa się Twoja firma?",
};

function CollectedDataBadges({
  data,
}: {
  data: Record<string, unknown>;
}) {
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
    <div className="flex flex-wrap gap-2 p-4">
      {entries.map(([k, v]) => (
        <span
          key={k}
          className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-300"
        >
          <span className="font-medium">{LABELS[k] ?? k}:</span>
          <span>{String(v)}</span>
        </span>
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
  const [collectedData, setCollectedData] = useState<Record<string, unknown>>(
    {},
  );
  const [createdClient, setCreatedClient] = useState<ClientResponse | null>(
    null,
  );
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
        setMessages((prev) => [
          ...prev,
          { role: "assistant", text: res.question },
        ]);
      } else {
        // created
        setCreatedClient(res.client);
        void queryClient.invalidateQueries({ queryKey: ["clients"] });
        const matchWord =
          res.matchCount === 1
            ? "dopasowanie"
            : res.matchCount < 5
              ? "dopasowania"
              : "dopasowań";
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            text: `✅ Profil firmy **${res.client.companyName}** został utworzony!\n\nZnaleziono **${res.matchCount} ${matchWord}** z naszej bazy ogłoszeń. Możesz je przeglądać na stronie klientów.`,
          },
        ]);
      }
      setTimeout(
        () => bottomRef.current?.scrollIntoView({ behavior: "smooth" }),
        50,
      );
    },
    onError: () => {
      toast.error("Błąd komunikacji z asystentem");
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: "Przepraszam, wystąpił błąd. Spróbuj ponownie.",
        },
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
    <div className="flex h-[calc(100vh-280px)] min-h-[500px] flex-col">
      {/* progress badges */}
      <CollectedDataBadges data={collectedData} />

      {/* messages */}
      <div className="flex-1 overflow-y-auto px-4 py-2">
        <AnimatePresence initial={false}>
          {messages.map((m, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className={cn("mb-4 flex", m.role === "user" ? "justify-end" : "justify-start")}
            >
              {m.role === "assistant" && (
                <div className="mr-2 mt-1 h-7 w-7 shrink-0 rounded-full bg-amber-500 flex items-center justify-center text-white text-xs font-bold">
                  AI
                </div>
              )}
              <div
                className={cn(
                  "max-w-[75%] rounded-3xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap",
                  m.role === "user"
                    ? "bg-stone-900 text-stone-100 dark:bg-stone-700"
                    : "bg-stone-100 text-stone-900 dark:bg-stone-800 dark:text-stone-100",
                )}
              >
                {m.text}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {sendMutation.isPending && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mb-4 flex justify-start"
          >
            <div className="mr-2 mt-1 h-7 w-7 shrink-0 rounded-full bg-amber-500 flex items-center justify-center text-white text-xs font-bold">
              AI
            </div>
            <div className="rounded-3xl bg-stone-100 px-4 py-3 text-sm dark:bg-stone-800">
              <span className="flex gap-1">
                {[0, 1, 2].map((i) => (
                  <motion.span
                    key={i}
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ repeat: Infinity, duration: 1, delay: i * 0.2 }}
                    className="h-1.5 w-1.5 rounded-full bg-stone-400 dark:bg-stone-500"
                  />
                ))}
              </span>
            </div>
          </motion.div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* post-creation actions */}
      {createdClient && (
        <div className="border-t border-stone-200 px-4 py-3 dark:border-stone-700 flex gap-3 justify-center">
          <button
            type="button"
            onClick={() => void navigate({ to: "/clients" })}
            className="rounded-full bg-amber-500 px-6 py-2 text-sm font-medium text-white hover:bg-amber-600"
          >
            Zobacz dopasowania →
          </button>
          <button
            type="button"
            onClick={() => {
              setMessages([INITIAL_MESSAGE]);
              setSessionId(undefined);
              setCollectedData({});
              setCreatedClient(null);
              setInput("");
            }}
            className="rounded-full border border-stone-300 px-6 py-2 text-sm text-stone-700 hover:bg-stone-100 dark:border-stone-600 dark:text-stone-300 dark:hover:bg-stone-800"
          >
            Dodaj kolejnego klienta
          </button>
        </div>
      )}

      {/* input */}
      {!createdClient && (
        <form
          onSubmit={handleSubmit}
          className="border-t border-stone-200 px-4 py-3 dark:border-stone-700"
        >
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Napisz wiadomość…"
              disabled={sendMutation.isPending}
              className="flex-1 rounded-full border border-stone-300 bg-white px-4 py-2 text-sm outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-200 disabled:opacity-50 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100 dark:focus:border-amber-500 dark:focus:ring-amber-900/40"
            />
            <button
              type="submit"
              disabled={!input.trim() || sendMutation.isPending}
              className="rounded-full bg-amber-500 px-5 py-2 text-sm font-medium text-white transition hover:bg-amber-600 disabled:opacity-40"
            >
              Wyślij
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
