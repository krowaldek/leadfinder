import { useThemeStore, type Theme } from "@/stores/theme-store";
import { Monitor, Moon, Sun } from "lucide-react";

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
    <button
      type="button"
      onClick={() => setTheme(next[theme])}
      title={`Motyw: ${labels[theme]}`}
      aria-label={`Motyw: ${labels[theme]}`}
      className="flex h-11 w-11 items-center justify-center rounded-2xl border border-stone-900/10 bg-stone-100 text-stone-600 transition hover:bg-stone-200 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
    >
      <Icon className="h-5 w-5" />
    </button>
  );
}
