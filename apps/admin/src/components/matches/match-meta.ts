import { format } from "date-fns";
import { pl } from "date-fns/locale";
import type { ClientMatchResponse } from "@leadfinder/contracts";

export const MATCH_STATUS_LABELS: Record<string, string> = {
  NEW: "Nowe",
  VIEWED: "Wyświetlone",
  DISMISSED: "Odrzucone",
  SHORTLISTED: "Wybrane",
};

export const KIND_LABELS: Record<string, string> = {
  DOSTAWA: "Dostawa",
  USLUGA: "Usługa",
  ROBOTY_BUDOWLANE: "Roboty bud.",
  SZKOLENIE: "Szkolenie",
  USLUGA_IT: "Usługi IT",
  USLUGA_BADAWCZO_ROZWOJOWA: "B+R",
  DORADZTWO: "Doradztwo",
  INNE: "Inne",
};

export const SOURCE_LABELS: Record<string, string> = {
  BAZA_KONKURENCYJNOSCI: "Baza Konkurencyjności",
  E_ZAMOWIENIA: "e-Zamówienia",
  PLATFORMA_ZAKUPOWA: "Platforma Zakupowa",
};

type PartAwareAnnouncement = {
  sourceSystem?: string;
  partIndex?: number;
  isMultiPart?: boolean;
  displayPartNumber?: number | null;
};

type SourceAwareAnnouncement = PartAwareAnnouncement & {
  url: string;
  sourceSystem: string;
  title: string;
};

export function buildAnnouncementPanelHref(
  announcement: Pick<ClientMatchResponse["announcement"], "id" | "externalId" | "sourceSystem" | "partIndex">,
) {
  const params = new URLSearchParams({
    id: announcement.id,
    search: announcement.externalId,
    source: announcement.sourceSystem,
    partIndex: String(announcement.partIndex),
  });

  return `/announcements?${params.toString()}`;
}

export function getAnnouncementPartLabel(
  announcement: PartAwareAnnouncement,
) {
  const displayPartNumber = announcement.displayPartNumber
    ?? (announcement.isMultiPart && typeof announcement.partIndex === "number"
      ? announcement.partIndex + 1
      : null);

  if (!announcement.isMultiPart || !displayPartNumber) {
    return null;
  }

  return `Część ${displayPartNumber}`;
}

export function getAnnouncementSourceCtaLabel(
  announcement: PartAwareAnnouncement,
) {
  const partLabel = getAnnouncementPartLabel(announcement);
  return partLabel ? `Przejdź do [${partLabel.toLocaleLowerCase("pl-PL")}]` : "Przejdź do oferty";
}

export function buildAnnouncementSourceHref(
  announcement: SourceAwareAnnouncement,
) {
  if (
    announcement.sourceSystem !== "BAZA_KONKURENCYJNOSCI"
    || !announcement.isMultiPart
    || !announcement.displayPartNumber
  ) {
    return announcement.url;
  }

  const fragmentText = normalizeTextFragment(announcement.title)
    || `Część ${announcement.displayPartNumber}`;
  const baseUrl = announcement.url.split("#")[0] ?? announcement.url;

  return `${baseUrl}#:~:text=${encodeURIComponent(fragmentText)}`;
}

function normalizeTextFragment(text: string | null | undefined) {
  if (!text) return null;

  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length < 3) return null;

  return normalized.slice(0, 120);
}

export function formatMoney(value: string | null | undefined) {
  if (!value) return "—";
  return Number(value).toLocaleString("pl-PL", {
    style: "currency",
    currency: "PLN",
    maximumFractionDigits: 0,
  });
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  return format(new Date(value), "dd.MM.yyyy HH:mm", { locale: pl });
}

export function getSimilarityMeta(similarity: number) {
  const percentage = Math.round(similarity * 100);

  if (percentage >= 85) {
    return {
      percentage,
      label: "Świetne",
      tone: "from-blue-600 via-indigo-500 to-sky-400",
      textTone: "text-blue-600 dark:text-blue-300",
      railTone: "bg-blue-500",
    };
  }

  if (percentage >= 70) {
    return {
      percentage,
      label: "Bardzo dobre",
      tone: "from-cyan-500 via-blue-500 to-indigo-500",
      textTone: "text-cyan-600 dark:text-cyan-300",
      railTone: "bg-cyan-500",
    };
  }

  if (percentage >= 55) {
    return {
      percentage,
      label: "Dobre",
      tone: "from-amber-400 via-orange-400 to-yellow-500",
      textTone: "text-amber-600 dark:text-amber-300",
      railTone: "bg-amber-500",
    };
  }

  return {
    percentage,
    label: "Słabsze",
    tone: "from-slate-400 via-slate-500 to-slate-600",
    textTone: "text-slate-500 dark:text-slate-300",
    railTone: "bg-slate-400",
  };
}

export function getDeadlineMeta(deadlineAt: string | null | undefined) {
  if (!deadlineAt) {
    return {
      label: "Brak terminu",
      detail: "Bez deadline'u w danych",
      urgent: false,
      expired: false,
    };
  }

  const date = new Date(deadlineAt);
  const diffDays = Math.ceil((date.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return {
      label: format(date, "dd.MM.yyyy", { locale: pl }),
      detail: "Po terminie",
      urgent: false,
      expired: true,
    };
  }

  return {
    label: format(date, "dd.MM.yyyy", { locale: pl }),
    detail: diffDays <= 3 ? `Pilne · ${diffDays} dni` : `Za ${diffDays} dni`,
    urgent: diffDays <= 3,
    expired: false,
  };
}

export function parseSearchContext(ctx: string | null | undefined): Array<{ label: string; value: string }> {
  if (!ctx) return [];

  return ctx
    .split(" | ")
    .map((part) => {
      const colonIdx = part.indexOf(": ");
      if (colonIdx === -1) return { label: "Kontekst", value: part };
      return { label: part.slice(0, colonIdx), value: part.slice(colonIdx + 2) };
    })
    .filter((row) => row.value.trim().length > 0);
}
