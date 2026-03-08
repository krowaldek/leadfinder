import {
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { LoginPage } from "@/features/auth/LoginPage";
import { UsersPage } from "@/features/users/UsersPage";
import { AnnouncementsPage } from "@/features/announcements/AnnouncementsPage";
import { ClientsPage } from "@/features/clients/ClientsPage";
import { ClientPromptPage } from "@/features/clients/ClientPromptPage";
import { getAuthSnapshot } from "@/stores/auth-store";

function requireAuth() {
  const { accessToken } = getAuthSnapshot();

  if (!accessToken) {
    throw redirect({ to: "/login" });
  }
}

const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  beforeLoad: () => {
    const { accessToken } = getAuthSnapshot();
    if (accessToken) {
      throw redirect({ to: "/users" });
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
    throw redirect({ to: "/users" });
  },
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

const clientPromptRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/clients/prompt",
  component: ClientPromptPage,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  appLayoutRoute.addChildren([homeRoute, usersRoute, announcementsRoute, clientsRoute, clientPromptRoute]),
]);

export const router = createRouter({
  routeTree,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
