import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { queryClient } from "@/lib/query-client";
import { router } from "@/router";

describe("portal", () => {
  it("renders home page heading", async () => {
    window.history.pushState({}, "", "/");

    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: "Leadfinder" })).toBeInTheDocument();
  });
});
