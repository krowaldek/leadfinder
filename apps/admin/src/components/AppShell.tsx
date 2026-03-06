import { logout } from "@/features/auth/auth-api";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";
import { Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { LogOut, ShieldCheck, Users } from "lucide-react";

const navItems = [
  {
    to: "/users",
    label: "Uzytkownicy",
    icon: Users,
  },
];

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, clearSession } = useAuthStore();

  const handleLogout = async () => {
    try {
      await logout();
    } finally {
      clearSession();
      void navigate({ to: "/login" });
    }
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(201,164,90,0.15),_transparent_30%),linear-gradient(135deg,_#f7f3ea,_#efe4d4_45%,_#e8ddcf)] text-stone-900">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl gap-6 px-4 py-6 md:px-6 lg:px-8">
        <aside className="hidden w-72 shrink-0 flex-col rounded-[2rem] border border-stone-900/10 bg-stone-950 p-6 text-stone-100 shadow-[0_20px_70px_rgba(24,24,21,0.28)] lg:flex">
          <div>
            <p className="text-xs uppercase tracking-[0.4em] text-amber-300/80">Leadfinder</p>
            <h1 className="mt-3 font-[Cormorant_Garamond] text-4xl font-semibold leading-none">
              Panel Administracyjny
            </h1>
            <p className="mt-4 text-sm text-stone-300">
              Wewnetrzny panel do zarzadzania kontami i dostepem do systemu.
            </p>
          </div>

          <nav className="mt-10 space-y-2">
            {navItems.map(({ to, label, icon: Icon }) => {
              const active = location.pathname === to;
              return (
                <Link
                  key={to}
                  to={to}
                  className={cn(
                    "flex items-center gap-3 rounded-2xl px-4 py-3 text-sm transition",
                    active
                      ? "bg-amber-100 text-stone-950"
                      : "text-stone-300 hover:bg-stone-900 hover:text-stone-100",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span>{label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="mt-auto rounded-[1.75rem] border border-stone-800 bg-stone-900/60 p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-200 text-stone-950">
                <ShieldCheck className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-medium">{user?.fullName}</p>
                <p className="text-xs uppercase tracking-[0.25em] text-stone-400">
                  {user?.systemRole === "SUPER_ADMIN" ? "SUPER ADMIN" : "ADMINISTRATOR"}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-full border border-stone-700 px-4 py-2 text-sm text-stone-200 transition hover:border-amber-200 hover:text-amber-100"
            >
              <LogOut className="h-4 w-4" />
              Wyloguj
            </button>
          </div>
        </aside>

        <main className="flex-1">
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
            className="min-h-[calc(100vh-3rem)] rounded-[2rem] border border-white/60 bg-white/80 p-4 shadow-[0_30px_90px_rgba(117,84,36,0.12)] backdrop-blur md:p-6"
          >
            <div className="mb-6 flex items-center justify-between border-b border-stone-900/10 pb-4">
              <div>
                <p className="text-xs uppercase tracking-[0.35em] text-stone-500">Leadfinder</p>
                <h2 className="mt-2 font-[Cormorant_Garamond] text-4xl font-semibold text-stone-950">
                  Zarzadzanie uzytkownikami
                </h2>
              </div>
              <div className="rounded-full border border-amber-300 bg-amber-50 px-4 py-2 text-xs uppercase tracking-[0.28em] text-amber-900">
                Panel wewnetrzny
              </div>
            </div>
            <Outlet />
          </motion.div>
        </main>
      </div>
    </div>
  );
}
