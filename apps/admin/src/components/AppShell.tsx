import { useAuthStore } from "@/stores/auth-store";
import { Outlet, useNavigate, useLocation } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { Menu } from "lucide-react";
import { useState } from "react";
import { logout } from "@/features/auth/auth-api";
import { Sidebar } from "@/components/Sidebar";
import { ThemeToggle } from "@/components/ThemeToggle";

const PAGE_META: Record<string, { title: string; badge: string }> = {
  "/users": { title: "Zarządzanie użytkownikami", badge: "Panel wewnętrzny" },
  "/announcements": { title: "Ogłoszenia", badge: "Scraper" },
  "/clients": { title: "Klienci", badge: "CRM" },
  "/clients/prompt": { title: "Nowy klient", badge: "AI" },
};

export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const { clearSession } = useAuthStore();
  const [mobileOpen, setMobileOpen] = useState(false);

  const pageMeta = PAGE_META[location.pathname] ?? { title: "", badge: "Panel wewnętrzny" };

  const handleLogout = async () => {
    try {
      await logout();
    } finally {
      clearSession();
      void navigate({ to: "/login" });
    }
  };

  return (
    <div className="min-h-screen overflow-x-hidden bg-[radial-gradient(circle_at_top_left,_rgba(201,164,90,0.15),_transparent_30%),linear-gradient(135deg,_#f7f3ea,_#efe4d4_45%,_#e8ddcf)] text-stone-900 dark:bg-[radial-gradient(circle_at_top_left,_rgba(201,164,90,0.08),_transparent_30%),linear-gradient(135deg,_#1a1714,_#1e1b17_45%,_#231f1a)] dark:text-stone-100">
      <div className="flex min-h-screen w-full gap-6 px-4 py-6 md:px-6 lg:px-8">
        <Sidebar
          onLogout={handleLogout}
          mobileOpen={mobileOpen}
          onMobileOpenChange={setMobileOpen}
        />

        <main className="flex min-w-0 flex-1 flex-col gap-4">
          {/* Topbar */}
          <div className="flex items-center justify-between rounded-[2rem] border border-white/60 bg-white/80 px-5 py-4 shadow-[0_8px_30px_rgba(117,84,36,0.10)] backdrop-blur dark:border-stone-700/60 dark:bg-stone-900/80 dark:shadow-[0_8px_30px_rgba(0,0,0,0.3)]">
            <div>
              <p className="text-xs uppercase tracking-[0.35em] text-stone-500 dark:text-stone-400">
                Leadfinder
              </p>
              <p className="mt-0.5 font-[Cormorant_Garamond] text-2xl font-semibold text-stone-950 dark:text-stone-100">
                Panel Administracyjny
              </p>
            </div>
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <button
                type="button"
                onClick={() => setMobileOpen(true)}
                className="flex h-11 w-11 items-center justify-center rounded-2xl border border-stone-900/10 bg-stone-950 text-stone-100 transition hover:bg-stone-800 dark:border-stone-700 dark:bg-stone-800 dark:hover:bg-stone-700 lg:hidden"
                aria-label="Otwórz menu"
              >
                <Menu className="h-5 w-5" />
              </button>
            </div>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
            className="min-h-[calc(100vh-3rem)] min-w-0 rounded-[2rem] border border-white/60 bg-white/80 p-4 shadow-[0_30px_90px_rgba(117,84,36,0.12)] backdrop-blur dark:border-stone-700/60 dark:bg-stone-900/80 dark:shadow-[0_30px_90px_rgba(0,0,0,0.4)] md:p-6"
          >
            <div className="mb-6 flex min-w-0 items-center justify-between border-b border-stone-900/10 pb-4 dark:border-stone-700/60">
              <div className="min-w-0 flex-1">
                <p className="text-xs uppercase tracking-[0.35em] text-stone-500 dark:text-stone-400">
                  Leadfinder
                </p>
                <h2 className="mt-2 font-[Cormorant_Garamond] text-4xl font-semibold text-stone-950 dark:text-stone-100">
                  {pageMeta.title}
                </h2>
              </div>
              <div className="ml-4 shrink-0 rounded-full border border-amber-300 bg-amber-50 px-4 py-2 text-xs uppercase tracking-[0.28em] text-amber-900 dark:border-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
                {pageMeta.badge}
              </div>
            </div>
            <Outlet />
          </motion.div>
        </main>
      </div>
    </div>
  );
}
