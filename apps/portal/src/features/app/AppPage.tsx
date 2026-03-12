import { format } from "date-fns";
import { pl } from "date-fns/locale";
import { useAuthStore } from "@/stores/auth-store";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function AppPage() {
  const user = useAuthStore((s) => s.user);

  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Panel</h1>

      <Card>
        <CardHeader>
          <CardTitle>Sesja</CardTitle>
          <CardDescription>Minimalny ekran chroniony guardem route.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          <div>
            <span className="text-muted-foreground">Użytkownik:</span>{" "}
            <span className="font-medium">{user?.fullName ?? "—"}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Email:</span>{" "}
            <span className="font-medium">{user?.email ?? "—"}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Dzisiaj:</span>{" "}
            <span className="font-medium">{format(new Date(), "PPP", { locale: pl })}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
