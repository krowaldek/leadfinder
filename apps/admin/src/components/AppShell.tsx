import { useAuthStore } from "@/stores/auth-store";
import { Outlet, useNavigate, useLocation } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import { useState } from "react";
import { logout } from "@/features/auth/auth-api";
import { Sidebar } from "@/components/Sidebar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

const PAGE_META: Record<string, { title: string; badge: string }> = {
  "/users": { title: "Użytkownicy", badge: "Panel wewnętrzny" },
  "/announcements": { title: "Ogłoszenia", badge: "Scraper" },
  "/clients": { title: "Klienci", badge: "CRM" },
  "/clients/prompt": { title: "Nowy klient", badge: "AI" },
  "/clients/matches": { title: "Zapytania klientów", badge: "CRM" },
};

export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const { clearSession } = useAuthStore();
  const [mobileOpen, setMobileOpen] = useState(false);

  const pageMeta = PAGE_META[location.pathname] ?? { title: "", badge: "Panel" };

  const handleLogout = async () => {
    try {
      await logout();
    } finally {
      clearSession();
      void navigate({ to: "/login" });
    }
  };

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <Sidebar
        onLogout={handleLogout}
        mobileOpen={mobileOpen}
        onMobileOpenChange={setMobileOpen}
      />

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header className="flex h-14 items-center gap-4 border-b px-4 lg:px-6">
          <Button
            variant="ghost"
            size="icon-sm"
            className="lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Otwórz menu"
          >
            <Menu className="size-5" />
          </Button>
          <div className="flex flex-1 items-center gap-2">
            <span className="text-sm font-semibold">Leadfinder Admin</span>
            {pageMeta.title && (
              <>
                <span className="text-muted-foreground">/</span>
                <span className="text-sm text-muted-foreground">{pageMeta.title}</span>
              </>
            )}
          </div>
          <ThemeToggle />
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto p-4 lg:p-6">
          <div className="mb-4 flex items-center justify-between">
            <h1 className="text-xl font-semibold tracking-tight">{pageMeta.title}</h1>
            {pageMeta.badge && (
              <span className="rounded-md border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {pageMeta.badge}
              </span>
            )}
          </div>
          <Separator className="mb-6" />
          <Outlet />
        </main>
      </div>
    </div>
  );
}
