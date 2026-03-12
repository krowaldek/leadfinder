import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { zodResolver } from "@hookform/resolvers/zod";
import { loginSchema, type LoginInput, authResponseSchema } from "@leadfinder/contracts";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginPage() {
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);

  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const login = useMutation({
    mutationFn: async (input: LoginInput) => {
      const res = await api.post("/auth/login", input);
      return authResponseSchema.parse(res.data);
    },
    onSuccess: (session) => {
      setSession(session);
      toast.success("Zalogowano");
      navigate({ to: "/app" });
    },
    onError: () => {
      toast.error("Nie udało się zalogować");
    },
  });

  return (
    <div className="mx-auto w-full max-w-md">
      <Card>
        <CardHeader>
          <CardTitle>Logowanie</CardTitle>
          <CardDescription>Użyj konta, które masz w systemie.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4"
            onSubmit={form.handleSubmit((values) => login.mutate(values))}
          >
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="name@company.com"
                {...form.register("email")}
              />
              {form.formState.errors.email ? (
                <p className="text-sm text-destructive">{form.formState.errors.email.message}</p>
              ) : null}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="password">Hasło</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                {...form.register("password")}
              />
              {form.formState.errors.password ? (
                <p className="text-sm text-destructive">
                  {form.formState.errors.password.message}
                </p>
              ) : null}
            </div>

            <Button type="submit" disabled={login.isPending}>
              {login.isPending ? "Logowanie…" : "Zaloguj"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
