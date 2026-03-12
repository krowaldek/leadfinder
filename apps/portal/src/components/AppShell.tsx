import { Outlet, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button, buttonVariants } from "@/components/ui/button";
import { useAuthStore } from "@/stores/auth-store";
import { api } from "@/lib/api";
import { toast } from "sonner";

export function AppShell() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const clearSession = useAuthStore((s) => s.clearSession);

  async function handleLogout() {
    try {
      await api.post("/auth/logout");
    } catch {
      // noop
    } finally {
      clearSession();
      toast.success("Wylogowano");
    }
  }

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <Link to="/" className="font-semibold">
              Leadfinder
            </Link>
            <span className="text-xs text-muted-foreground">Portal</span>
          </div>

          <nav className="flex items-center gap-2">
            <ThemeToggle />
            {accessToken ? (
              <>
                <Link
                  to="/app"
                  className={buttonVariants({ variant: "secondary", size: "default" })}
                >
                  Panel
                </Link>
                <Button variant="ghost" onClick={handleLogout}>
                  Wyloguj
                </Button>
              </>
            ) : (
              <Link to="/login" className={buttonVariants({ variant: "default", size: "default" })}>
                Zaloguj
              </Link>
            )}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-10">
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
        >
          <Outlet />
        </motion.div>
      </main>
    </div>
  );
}
