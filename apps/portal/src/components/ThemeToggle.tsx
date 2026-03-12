import { Moon, Sun, Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Theme, useThemeStore } from "@/stores/theme-store";

const order: Theme[] = ["system", "light", "dark"];

function iconFor(theme: Theme) {
  if (theme === "light") return Sun;
  if (theme === "dark") return Moon;
  return Monitor;
}

export function ThemeToggle() {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);

  function next() {
    const idx = order.indexOf(theme);
    setTheme(order[(idx + 1) % order.length]);
  }

  const Icon = iconFor(theme);

  return (
    <Button variant="ghost" size="icon-sm" onClick={next} aria-label="Zmień motyw">
      <Icon className="size-4" />
    </Button>
  );
}
