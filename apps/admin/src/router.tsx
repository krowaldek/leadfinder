import {
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";
import { refreshSession } from "@/features/auth/auth-api";
import { AppShell } from "@/components/AppShell";
import { LoginPage } from "@/features/auth/LoginPage";
import { DashboardPage } from "@/features/dashboard/DashboardPage";
import { UsersPage } from "@/features/users/UsersPage";
import { AnnouncementsPage } from "@/features/announcements/AnnouncementsPage";
import { ClientsPage } from "@/features/clients/ClientsPage";
import { ClientDetailPage } from "@/features/clients/ClientDetailPage";
import { ClientMatchesPage } from "@/features/clients/ClientMatchesPage";
import { ProjectsPage } from "@/features/projects/ProjectsPage";
import { TopicsPage } from "@/features/topics/TopicsPage";
import { LogsPage } from "@/features/logs/LogsPage";
import { getAuthSnapshot } from "@/stores/auth-store";

async function requireAuth() {
  const { accessToken, setSession, clearSession } = getAuthSnapshot();

  if (accessToken) {
    return;
  }

  try {
    const session = await refreshSession();
    setSession(session);
  } catch {
    clearSession();
    throw redirect({
      to: "/login",
      search: {
        redirect: window.location.pathname + window.location.search,
      },
    });
  }
}

const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  beforeLoad: async ({ search }) => {
    const { accessToken, setSession, clearSession } = getAuthSnapshot();

    if (accessToken) {
      throw redirect({ to: search.redirect ?? "/dashboard" });
    }

    try {
      const session = await refreshSession();
      setSession(session);
      throw redirect({ to: search.redirect ?? "/dashboard" });
    } catch {
      clearSession();
    }
  },
  component: LoginPage,
});

const appLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app-layout",
  beforeLoad: requireAuth,
  component: AppShell,
});

const homeRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/dashboard" });
  },
});

const dashboardRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/dashboard",
  component: DashboardPage,
});

const usersRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/users",
  component: UsersPage,
});

const announcementsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/announcements",
  component: AnnouncementsPage,
});

const clientsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/clients",
  component: ClientsPage,
});

const clientMatchesRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/views/matches",
  component: ClientMatchesPage,
});

const clientDetailRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/clients/$clientId",
  component: ClientDetailPage,
});

const projectsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/projects",
  component: ProjectsPage,
});

const topicsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/topics",
  component: TopicsPage,
});

const logsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/logs",
  component: LogsPage,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  appLayoutRoute.addChildren([
    homeRoute,
    dashboardRoute,
    usersRoute,
    announcementsRoute,
    clientsRoute,
    clientMatchesRoute,
    clientDetailRoute,
    projectsRoute,
    topicsRoute,
    logsRoute,
  ]),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
