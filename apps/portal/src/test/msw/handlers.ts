import { http, HttpResponse } from "msw";

export const handlers = [
  http.post("*/auth/login", async () => {
    return HttpResponse.json({
      user: {
        id: "u_1",
        email: "demo@leadfinder.dev",
        firstName: "Demo",
        lastName: "User",
        fullName: "Demo User",
        systemRole: "ADMIN",
        accountType: "PERSONAL",
        companyName: null,
        status: "ACTIVE",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      accessToken: "token_demo",
    });
  }),
];
