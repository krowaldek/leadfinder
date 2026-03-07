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

const routeTree = rootRoute.addChildren([
  loginRoute,
  appLayoutRoute.addChildren([homeRoute, usersRoute, announcementsRoute]),
]);

export const router = createRouter({
  routeTree,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
