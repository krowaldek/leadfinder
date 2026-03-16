import { useAuthStore } from "@/stores/auth-store";
import { Outlet, useNavigate } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import { useState } from "react";
import { logout } from "@/features/auth/auth-api";
import { Sidebar } from "@/components/Sidebar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";

export function AppShell() {
  const navigate = useNavigate();
  const { clearSession } = useAuthStore();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLogout = async () => {
    try {
      await logout();
    } finally {
      clearSession();
      void navigate({ to: "/login", search: { redirect: undefined } });
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar
        onLogout={handleLogout}
        mobileOpen={mobileOpen}
        onMobileOpenChange={setMobileOpen}
      />

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center justify-between border-b px-6">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Otwórz menu"
          >
            <Menu className="size-4" />
          </Button>
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
