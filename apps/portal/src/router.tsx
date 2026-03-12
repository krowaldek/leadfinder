import {
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { LoginPage } from "@/features/auth/LoginPage";
import { HomePage } from "@/features/home/HomePage";
import { AppPage } from "@/features/app/AppPage";
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

const publicLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "public-layout",
  component: AppShell,
});

const indexRoute = createRoute({
  getParentRoute: () => publicLayoutRoute,
  path: "/",
  component: HomePage,
});

const loginRoute = createRoute({
  getParentRoute: () => publicLayoutRoute,
  path: "/login",
  component: LoginPage,
});

const appRoute = createRoute({
  getParentRoute: () => publicLayoutRoute,
  path: "/app",
  beforeLoad: requireAuth,
  component: AppPage,
});

const routeTree = rootRoute.addChildren([
  publicLayoutRoute.addChildren([indexRoute, loginRoute, appRoute]),
]);

export const router = createRouter({
  routeTree,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
