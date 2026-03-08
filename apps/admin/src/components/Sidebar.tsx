import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";
import * as Dialog from "@radix-ui/react-dialog";
import { Link, useLocation } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { LogOut, ShieldCheck, Users, FileText, Building2, X } from "lucide-react";

const navItems = [
  {
    to: "/users",
    label: "Użytkownicy",
    icon: Users,
  },
  {
    to: "/announcements",
    label: "Ogłoszenia",
    icon: FileText,
  },
  {
    to: "/clients",
    label: "Klienci",
    icon: Building2,
  },
];

interface SidebarContentProps {
  onNavigate?: () => void;
  onLogout: () => void;
}

function SidebarContent({ onNavigate, onLogout }: SidebarContentProps) {
  const location = useLocation();
  const { user } = useAuthStore();

  return (
    <div className="flex h-full flex-col p-6">
      <div>
        <p className="text-xs uppercase tracking-[0.4em] text-amber-300/80">
          Leadfinder
        </p>
        <h1 className="mt-3 font-[Cormorant_Garamond] text-4xl font-semibold leading-none text-stone-100">
          Panel Administracyjny
        </h1>
        <p className="mt-4 text-sm text-stone-400">
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
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 rounded-2xl px-4 py-3 text-sm transition",
                active
                  ? "bg-amber-100 text-stone-950"
                  : "text-stone-300 hover:bg-stone-800 hover:text-stone-100",
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
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-200 text-stone-950">
            <ShieldCheck className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-stone-100">
              {user?.fullName}
            </p>
            <p className="text-xs uppercase tracking-[0.25em] text-stone-400">
              {user?.systemRole === "SUPER_ADMIN"
                ? "SUPER ADMIN"
                : "ADMINISTRATOR"}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onLogout}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-full border border-stone-700 px-4 py-2 text-sm text-stone-200 transition hover:border-amber-400 hover:text-amber-100"
        >
          <LogOut className="h-4 w-4" />
          Wyloguj
        </button>
      </div>
    </div>
  );
}

interface SidebarProps {
  onLogout: () => void;
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
}

export function Sidebar({
  onLogout,
  mobileOpen,
  onMobileOpenChange,
}: SidebarProps) {
  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden w-72 shrink-0 flex-col rounded-[2rem] border border-stone-900/10 bg-stone-950 text-stone-100 shadow-[0_20px_70px_rgba(24,24,21,0.28)] dark:border-stone-700/40 dark:shadow-[0_20px_70px_rgba(0,0,0,0.5)] lg:flex">
        <SidebarContent onLogout={onLogout} />
      </aside>

      {/* Mobile drawer */}
      <Dialog.Root open={mobileOpen} onOpenChange={onMobileOpenChange}>
        <AnimatePresence>
          {mobileOpen && (
            <Dialog.Portal forceMount>
              {/* Backdrop */}
              <Dialog.Overlay asChild>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="fixed inset-0 z-40 bg-stone-950/60 backdrop-blur-sm"
                />
              </Dialog.Overlay>

              {/* Drawer panel */}
              <Dialog.Content asChild aria-describedby={undefined}>
                <motion.div
                  initial={{ x: "-100%" }}
                  animate={{ x: 0 }}
                  exit={{ x: "-100%" }}
                  transition={{ type: "spring", damping: 28, stiffness: 280 }}
                  className="fixed inset-y-0 left-0 z-50 w-72 rounded-r-[2rem] bg-stone-950 text-stone-100 shadow-[8px_0_40px_rgba(24,24,21,0.32)]"
                >
                  <Dialog.Title className="sr-only">
                    Menu nawigacyjne
                  </Dialog.Title>

                  <Dialog.Close asChild>
                    <button
                      type="button"
                      className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full border border-stone-800 text-stone-400 transition hover:border-stone-600 hover:text-stone-100"
                      aria-label="Zamknij menu"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </Dialog.Close>

                  <SidebarContent
                    onNavigate={() => onMobileOpenChange(false)}
                    onLogout={() => {
                      onMobileOpenChange(false);
                      onLogout();
                    }}
                  />
                </motion.div>
              </Dialog.Content>
            </Dialog.Portal>
          )}
        </AnimatePresence>
      </Dialog.Root>
    </>
  );
}
