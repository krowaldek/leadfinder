import { useThemeStore, type Theme } from "@/stores/theme-store";
import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

const icons: Record<Theme, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

const next: Record<Theme, Theme> = {
  light: "dark",
  dark: "system",
  system: "light",
};

const labels: Record<Theme, string> = {
  light: "Jasny",
  dark: "Ciemny",
  system: "Systemowy",
};

export function ThemeToggle() {
  const { theme, setTheme } = useThemeStore();
  const Icon = icons[theme];

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={() => setTheme(next[theme])}
      title={`Motyw: ${labels[theme]}`}
      aria-label={`Motyw: ${labels[theme]}`}
    >
      <Icon className="size-4" />
    </Button>
  );
}
