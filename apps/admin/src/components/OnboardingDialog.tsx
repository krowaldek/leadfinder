/**
 * OnboardingDialog — 2-step client acquisition flow.
 *
 * Step 1: "Czego szukasz / czym się zajmujesz?" — free text
 * Step 2: Email (+ placeholder for social login buttons)
 * Result: success card with link to the created client
 *
 * Designed to be reusable on both the admin dashboard and the future
 * landing page (portal).
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ArrowRight, CheckCircle2, Loader2, Mail, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { OnboardResponse } from "@leadfinder/contracts";

// ── API call ─────────────────────────────────────────────────────────────────

async function onboardClient(activity: string, email: string): Promise<OnboardResponse> {
  const res = await api.post<OnboardResponse>("/clients/onboard", { activity, email });
  return res.data;
}

// ── Types ─────────────────────────────────────────────────────────────────────

type Step = "activity" | "email" | "success";

interface OnboardingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function OnboardingDialog({ open, onOpenChange }: OnboardingDialogProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<Step>("activity");
  const [activity, setActivity] = useState("");
  const [email, setEmail] = useState("");
  const [result, setResult] = useState<OnboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => onboardClient(activity.trim(), email.trim()),
    onSuccess: (data) => {
      setResult(data);
      setStep("success");
      void queryClient.invalidateQueries({ queryKey: ["clients"] });
      void queryClient.invalidateQueries({ queryKey: ["all-projects"] });
      void queryClient.invalidateQueries({ queryKey: ["all-topics"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        "Coś poszło nie tak. Sprawdź połączenie i spróbuj ponownie.";
      setError(msg);
    },
  });

  function handleClose(v: boolean) {
    if (!v) {
      // reset on close
      setTimeout(() => {
        setStep("activity");
        setActivity("");
        setEmail("");
        setResult(null);
        setError(null);
      }, 300);
    }
    onOpenChange(v);
  }

  function goToClient() {
    if (result) {
      void navigate({ to: "/clients/$clientId", params: { clientId: result.client.id } });
    }
    handleClose(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            Nowy klient
          </DialogTitle>
        </DialogHeader>

        {/* ── Step 1 ── */}
        {step === "activity" && (
          <div className="space-y-5">
            <div className="space-y-2">
              <p className="text-sm font-medium">Czego szukasz? Czym się zajmujesz?</p>
              <p className="text-xs text-muted-foreground">
                Opisz swoją działalność lub rodzaj zleceń, których szukasz — im więcej szczegółów,
                tym lepiej dopasuję ogłoszenia.
              </p>
              <textarea
                autoFocus
                value={activity}
                onChange={(e) => setActivity(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && activity.trim().length >= 5) {
                    setStep("email");
                  }
                }}
                placeholder="np. Firma szkoleniowa specjalizująca się w kursach językowych i szkoleniach miękkich dla sektora publicznego…"
                rows={5}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none"
              />
              <p className="text-xs text-muted-foreground text-right">{activity.trim().length}/2000</p>
            </div>
            <Button
              className="w-full"
              disabled={activity.trim().length < 5}
              onClick={() => setStep("email")}
            >
              Dalej
              <ArrowRight className="ml-2 size-4" />
            </Button>
          </div>
        )}

        {/* ── Step 2 ── */}
        {step === "email" && (
          <div className="space-y-5">
            <div className="space-y-2">
              <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2">
                <Sparkles className="size-3.5 shrink-0 text-primary" />
                <p className="text-xs text-muted-foreground line-clamp-2">{activity}</p>
              </div>

              <p className="text-sm font-medium pt-1">
                Świetnie! Potrzebujemy już tylko jednej rzeczy.
              </p>
              <p className="text-xs text-muted-foreground">
                Podaj swój adres email — wyślemy Ci powiadomienia o nowych pasujących ogłoszeniach.
              </p>

              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <Input
                  autoFocus
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && isValidEmail(email)) {
                      setError(null);
                      mutation.mutate();
                    }
                  }}
                  placeholder="twoj@email.pl"
                  className="pl-9"
                />
              </div>

              {/* Placeholder for social login — to be implemented later */}
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">lub kontynuuj przez</span>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {(["Google", "Facebook", "LinkedIn"] as const).map((provider) => (
                  <Button
                    key={provider}
                    variant="outline"
                    size="sm"
                    disabled
                    className="text-xs text-muted-foreground"
                    title="Wkrótce dostępne"
                  >
                    {provider}
                  </Button>
                ))}
              </div>

              {error && (
                <p className="text-xs text-destructive">{error}</p>
              )}
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => { setStep("activity"); setError(null); }}
                disabled={mutation.isPending}
              >
                Wstecz
              </Button>
              <Button
                className="flex-1"
                disabled={!isValidEmail(email) || mutation.isPending}
                onClick={() => { setError(null); mutation.mutate(); }}
              >
                {mutation.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
                {mutation.isPending ? "Tworzę profil…" : "Utwórz profil"}
              </Button>
            </div>
          </div>
        )}

        {/* ── Success ── */}
        {step === "success" && result && (
          <div className="space-y-5 text-center">
            <div className="flex flex-col items-center gap-3 py-2">
              <div className="flex size-14 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
                <CheckCircle2 className="size-7 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="font-semibold text-base">{result.client.companyName}</p>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Profil klienta został utworzony. Analizuję ogłoszenia i wkrótce pojawią się dopasowania.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => handleClose(false)}>
                Zamknij
              </Button>
              <Button className="flex-1" onClick={goToClient}>
                Przejdź do profilu
                <ArrowRight className="ml-2 size-4" />
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function isValidEmail(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}
