import { AnnouncementStatus, AnnouncementSource, Prisma } from "@prisma/client";

export interface PzCsvRow {
  data_rozpoczecia: string;
  data_zakonczenia: string;
  firma_wystawiajaca: string;
  nazwisko_i_imie_wystawiajacego: string;
  email: string;
  telefon: string;
  nazwa: string;
  link: string;
  termin_platnosci: string;
  najwczesniejszy_termin_dostawy: string;
  napozniejszy_termin_dostawy: string;
  opcja_transportu: string;
  adres_dostawy: string;
  wymagania_dodatkowe: string;
  opis_dodatkowy_ON: string;
  przedmiot_zapytania: string;
  id_zapytania: string;
  opis_i_specyfikacja: string;
}

export type AnnouncementUpsertData = {
  sourceSystem: AnnouncementSource;
  externalId: string;
  partIndex: number;
  title: string;
  description: string | null;
  url: string;
  status: AnnouncementStatus;
  valueMin: Prisma.Decimal | null;
  valueMax: Prisma.Decimal | null;
  publishedAt: Date | null;
  deadlineAt: Date | null;
  rawData: Prisma.InputJsonValue;
};

export function getPzExternalId(row: PzCsvRow): string {
  const id = clean(row.id_zapytania);
  if (id) return id;

  const link = clean(row.link);
  if (link) {
    const match = link.match(/\/(\d+)(?:\/)?$/);
    if (match) return match[1]!;
    return link;
  }

  return `${clean(row.nazwa) ?? "bez-tytulu"}:${clean(row.data_rozpoczecia) ?? "bez-daty"}`;
}

export function mapPzRowToUpsertData(row: PzCsvRow): AnnouncementUpsertData {
  const publishedAt = parsePzDateTime(row.data_rozpoczecia);
  const deadlineAt = parsePzDateTime(row.data_zakonczenia);
  const now = new Date();

  return {
    sourceSystem: AnnouncementSource.PLATFORMA_ZAKUPOWA,
    externalId: getPzExternalId(row),
    partIndex: 0,
    title: clean(row.nazwa) ?? "Bez tytułu",
    description: buildDescription(row),
    url: clean(row.link) ?? "https://platformazakupowa.pl",
    status: deadlineAt && deadlineAt < now ? AnnouncementStatus.CLOSED : AnnouncementStatus.OPEN,
    valueMin: null,
    valueMax: null,
    publishedAt,
    deadlineAt,
    rawData: normalizeRow(row) as unknown as Prisma.InputJsonValue,
  };
}

function buildDescription(row: PzCsvRow): string | null {
  const parts: string[] = [];

  if (clean(row.firma_wystawiajaca)) {
    parts.push(`Zamawiający: ${clean(row.firma_wystawiajaca)}`);
  }
  if (clean(row.przedmiot_zapytania)) {
    parts.push(`Przedmiot: ${clean(row.przedmiot_zapytania)}`);
  }
  if (clean(row.termin_platnosci)) {
    parts.push(`Termin płatności: ${clean(row.termin_platnosci)}`);
  }
  if (clean(row.najwczesniejszy_termin_dostawy) || clean(row.napozniejszy_termin_dostawy)) {
    parts.push(
      `Dostawa: ${clean(row.najwczesniejszy_termin_dostawy) ?? "?"} → ${clean(row.napozniejszy_termin_dostawy) ?? "?"}`,
    );
  }
  if (clean(row.opcja_transportu)) {
    parts.push(`Transport: ${clean(row.opcja_transportu)}`);
  }

  const longText = [
    stripHtml(row.opis_i_specyfikacja),
    clean(row.opis_dodatkowy_ON),
    clean(row.wymagania_dodatkowe),
  ]
    .filter(Boolean)
    .join("\n\n")
    .trim();

  if (longText) {
    parts.push(truncate(longText, 3000));
  }

  return parts.length > 0 ? parts.join(" | ") : null;
}

function normalizeRow(row: PzCsvRow) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, typeof value === "string" ? value.trim() : value]),
  );
}

function parsePzDateTime(value: string): Date | null {
  const trimmed = clean(value);
  if (!trimmed) return null;
  const isoLike = trimmed.replace(" ", "T");
  const parsed = new Date(isoLike);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
