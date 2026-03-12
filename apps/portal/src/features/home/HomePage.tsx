import { Link } from "@tanstack/react-router";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";

export function HomePage() {
  return (
    <div className="grid gap-6">
      <div className="grid gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Leadfinder</h1>
        <p className="max-w-xl text-muted-foreground">
          Szkielet portalu klienta. Tu docelowo trafią watchlisty, alerty, zapisane filtry i
          przegląd zapytań.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Start</CardTitle>
          <CardDescription>Logowanie + routing + query + UI + testy.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Link to="/login" className={buttonVariants({ variant: "default", size: "default" })}>
            Zaloguj
          </Link>
          <Link to="/app" className={buttonVariants({ variant: "secondary", size: "default" })}>
            Przejdź do panelu
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
