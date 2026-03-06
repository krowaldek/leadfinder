import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { ArrowRight, KeyRound, Shield } from "lucide-react";
import { login, refreshSession } from "./auth-api";
import { loginSchema, type LoginInput } from "@leadfinder/contracts";
import { useAuthStore } from "@/stores/auth-store";
import { toast } from "sonner";

export function LoginPage() {
  const navigate = useNavigate();
  const setSession = useAuthStore((state) => state.setSession);
  const [isRestoringSession, setIsRestoringSession] = useState(true);

  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  useEffect(() => {
    let isMounted = true;

    const tryRestoreSession = async () => {
      try {
        const session = await refreshSession();
        if (!isMounted) return;
        setSession(session);
        await navigate({ to: "/users" });
      } catch {
      } finally {
        if (isMounted) {
          setIsRestoringSession(false);
        }
      }
    };

    void tryRestoreSession();

    return () => {
      isMounted = false;
    };
  }, [navigate, setSession]);

  const mutation = useMutation({
    mutationFn: login,
    onSuccess: async (session) => {
      setSession(session);
      toast.success("Zalogowano pomyslnie");
      await navigate({ to: "/users" });
    },
    onError: () => {
      toast.error("Logowanie nie powiodlo sie. Sprawdz dane logowania i stan API.");
    },
  });

  return (
    <div className="relative min-h-screen overflow-hidden bg-[linear-gradient(135deg,_#171614_0%,_#2a2217_32%,_#f2ebdd_32%,_#f7f2ea_100%)] text-stone-900">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(255,214,122,0.16),_transparent_25%),radial-gradient(circle_at_bottom_right,_rgba(64,36,12,0.14),_transparent_24%)]" />
      <div className="relative mx-auto grid min-h-screen max-w-7xl items-center gap-8 px-4 py-10 md:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:px-8">
        <motion.section
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: "easeOut" }}
          className="rounded-[2.5rem] border border-white/10 bg-stone-950/92 p-8 text-stone-100 shadow-[0_30px_120px_rgba(0,0,0,0.28)] md:p-10"
        >
          <div className="flex items-center gap-3 text-amber-300">
            <Shield className="h-5 w-5" />
            <span className="text-xs uppercase tracking-[0.35em]">Leadfinder panel</span>
          </div>
          <h1 className="mt-8 max-w-xl font-[Cormorant_Garamond] text-5xl leading-none md:text-7xl">
            Zarzadzaj kontami i dostepem do systemu.
          </h1>
          <p className="mt-6 max-w-xl text-sm leading-7 text-stone-300 md:text-base">
            Panel administracyjny sluzy do obslugi uzytkownikow, sesji i uprawnien.
          </p>
          <div className="mt-10 grid gap-3 md:grid-cols-2">
            {[
              "Bezpieczne sesje JWT",
              "Konta osobiste i firmowe",
              "Zarzadzanie uzytkownikami",
              "Dostep tylko dla administratorow",
            ].map((item) => (
              <div
                key={item}
                className="rounded-[1.6rem] border border-white/10 bg-white/5 px-4 py-4 text-sm text-stone-200"
              >
                {item}
              </div>
            ))}
          </div>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, x: 18 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.45, delay: 0.08, ease: "easeOut" }}
          className="rounded-[2.5rem] border border-stone-900/10 bg-white/80 p-8 shadow-[0_25px_90px_rgba(95,65,24,0.14)] backdrop-blur md:p-10"
        >
          <div className="flex items-center gap-3 text-stone-500">
            <KeyRound className="h-4 w-4" />
            <span className="text-xs uppercase tracking-[0.35em]">Dostep administratora</span>
          </div>
          <h2 className="mt-6 font-[Cormorant_Garamond] text-4xl font-semibold text-stone-950">
            Logowanie
          </h2>
          <p className="mt-3 text-sm leading-6 text-stone-600">
            Uzyj danych administratora, aby wejsc do panelu.
          </p>

          <form
            className="mt-8 grid gap-5"
            onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
          >
            <label className="grid gap-2 text-sm text-stone-700">
              <span className="uppercase tracking-[0.2em] text-stone-500">Email</span>
              <input
                {...form.register("email")}
                className="min-h-13 rounded-[1.4rem] border border-stone-900/10 bg-[#fcfaf6] px-4 outline-none transition focus:border-amber-500 focus:ring-2 focus:ring-amber-200"
              />
              {form.formState.errors.email ? (
                <span className="text-xs text-rose-600">{form.formState.errors.email.message}</span>
              ) : null}
            </label>

            <label className="grid gap-2 text-sm text-stone-700">
              <span className="uppercase tracking-[0.2em] text-stone-500">Haslo</span>
              <input
                type="password"
                {...form.register("password")}
                className="min-h-13 rounded-[1.4rem] border border-stone-900/10 bg-[#fcfaf6] px-4 outline-none transition focus:border-amber-500 focus:ring-2 focus:ring-amber-200"
              />
              {form.formState.errors.password ? (
                <span className="text-xs text-rose-600">
                  {form.formState.errors.password.message}
                </span>
              ) : null}
            </label>

            <button
              type="submit"
              disabled={mutation.isPending || isRestoringSession}
              className="mt-2 inline-flex min-h-13 items-center justify-center gap-2 rounded-full bg-stone-950 px-5 text-sm font-medium text-stone-50 transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isRestoringSession
                ? "Sprawdzanie sesji..."
                : mutation.isPending
                  ? "Trwa logowanie..."
                  : "Zaloguj"}
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>
        </motion.section>
      </div>
    </div>
  );
}
