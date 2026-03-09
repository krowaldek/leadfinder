import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { login, refreshSession } from "./auth-api";
import { loginSchema, type LoginInput } from "@leadfinder/contracts";
import { useAuthStore } from "@/stores/auth-store";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function LoginPage() {
  const navigate = useNavigate();
  const setSession = useAuthStore((state) => state.setSession);
  const [isRestoringSession, setIsRestoringSession] = useState(true);

  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
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
        if (isMounted) setIsRestoringSession(false);
      }
    };
    void tryRestoreSession();
    return () => { isMounted = false; };
  }, [navigate, setSession]);

  const mutation = useMutation({
    mutationFn: login,
    onSuccess: async (session) => {
      setSession(session);
      toast.success("Zalogowano pomyślnie");
      await navigate({ to: "/users" });
    },
    onError: () => {
      toast.error("Logowanie nie powiodło się. Sprawdź dane logowania.");
    },
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl">Leadfinder Admin</CardTitle>
          <CardDescription>
            Zaloguj się kontem administratora, aby uzyskać dostęp do panelu.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4"
            onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
          >
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                {...form.register("email")}
                aria-invalid={!!form.formState.errors.email}
                placeholder="admin@leadfinder.local"
              />
              {form.formState.errors.email && (
                <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="password">Hasło</Label>
              <Input
                id="password"
                type="password"
                {...form.register("password")}
                aria-invalid={!!form.formState.errors.password}
              />
              {form.formState.errors.password && (
                <p className="text-xs text-destructive">{form.formState.errors.password.message}</p>
              )}
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={mutation.isPending || isRestoringSession}
            >
              {isRestoringSession
                ? "Sprawdzanie sesji..."
                : mutation.isPending
                  ? "Logowanie..."
                  : "Zaloguj się"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}


