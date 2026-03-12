import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";
import { Link, useLocation } from "@tanstack/react-router";
import { LogOut, ShieldCheck, Users, FileText, Building2, ListChecks, ScrollText, LayoutDashboard, FolderKanban, Tags } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

interface NavItem {
  to: string;
  label: string;
  icon: React.ElementType;
  /** exact match only */
  exact?: boolean;
}

const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Podsumowanie",
    items: [
      { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, exact: true },
    ],
  },
  {
    label: "Klienci",
    items: [
      { to: "/clients", label: "Klienci", icon: Building2, exact: true },
      { to: "/projects", label: "Projekty", icon: FolderKanban, exact: true },
      { to: "/topics", label: "Tematy", icon: Tags, exact: true },
    ],
  },
  {
    label: "Widoki",
    items: [
      { to: "/views/matches", label: "Dopasowane oferty", icon: ListChecks },
    ],
  },
  {
    label: "System",
    items: [
      { to: "/users", label: "Użytkownicy", icon: Users },
      { to: "/announcements", label: "Ogłoszenia", icon: FileText },
      { to: "/logs", label: "Logi systemowe", icon: ScrollText },
    ],
  },
];

interface SidebarContentProps {
  onNavigate?: () => void;
  onLogout: () => void;
}

function SidebarContent({ onNavigate, onLogout }: SidebarContentProps) {
  const location = useLocation();
  const { user } = useAuthStore();

  function isActive(to: string, exact?: boolean) {
    if (exact) return location.pathname === to;
    return location.pathname === to || location.pathname.startsWith(to + "/");
  }

  return (
    <div className="flex h-full flex-col gap-2 p-4">
      <div className="px-2 py-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Leadfinder
        </p>
        <p className="mt-1 text-base font-semibold">Panel administracyjny</p>
      </div>

      <Separator />

      <nav className="flex-1 py-2 space-y-4 overflow-y-auto">
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground/60">
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.items.map(({ to, label, icon: Icon, exact }) => (
                <Link
                  key={to}
                  to={to}
                  onClick={onNavigate}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    isActive(to, exact)
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  <Icon className="size-4" />
                  {label}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <Separator />

      <div className="px-2 py-2">
        <div className="flex items-center gap-3 mb-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <ShieldCheck className="size-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{user?.fullName}</p>
            <p className="text-xs text-muted-foreground">
              {user?.systemRole === "SUPER_ADMIN" ? "Super Admin" : "Admin"}
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={onLogout}
        >
          <LogOut className="size-4" />
          Wyloguj
        </Button>
      </div>
    </div>
  );
}

interface SidebarProps {
  onLogout: () => void;
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
}

export function Sidebar({ onLogout, mobileOpen, onMobileOpenChange }: SidebarProps) {
  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 border-r bg-background lg:flex lg:flex-col">
        <SidebarContent onLogout={onLogout} />
      </aside>

      {/* Mobile drawer */}
      <Sheet open={mobileOpen} onOpenChange={onMobileOpenChange}>
        <SheetContent side="left" className="w-64 p-0">
          <SheetTitle className="sr-only">Menu nawigacyjne</SheetTitle>
          <SidebarContent
            onNavigate={() => onMobileOpenChange(false)}
            onLogout={onLogout}
          />
        </SheetContent>
      </Sheet>
    </>
  );
}


