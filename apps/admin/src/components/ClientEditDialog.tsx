import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useState, type KeyboardEvent, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  clientProfileFieldsSchema,
  type ClientProfileFields,
  type ClientResponse,
  type UpdateClient,
} from "@leadfinder/contracts";
import { cn } from "@/lib/utils";
import { updateClient } from "@/features/clients/clients-api";

interface ClientEditDialogProps {
  open: boolean;
  client: ClientResponse | null;
  onOpenChange: (open: boolean) => void;
}

export function ClientEditDialog({
  open,
  client,
  onOpenChange,
}: ClientEditDialogProps) {
  const [tags, setTags] = useState<string[]>(client?.negativeKeywords ?? []);
  const [tagInput, setTagInput] = useState("");
  const queryClient = useQueryClient();

  const form = useForm<ClientProfileFields>({
    resolver: zodResolver(clientProfileFieldsSchema),
    values: {
      companyName: client?.companyName ?? "",
      industry: client?.industry ?? "",
      geographicScope: client?.geographicScope ?? "NATIONAL",
      geographicDetails: client?.geographicDetails ?? "",
      budgetDescription: client?.budgetDescription ?? "",
      contactPersonName: client?.contactPersonName ?? "",
      contactPersonRole: client?.contactPersonRole ?? "",
    },
  });

  const mutation = useMutation({
    mutationFn: (data: UpdateClient) => updateClient(client!.id, data),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["clients"] });
      toast.success(
        "Profil zaktualizowany. Dopasowania zostaną przeliczone w tle.",
      );
      onOpenChange(false);
    },
    onError: () => toast.error("Nie udało się zapisać zmian"),
  });

  // ── tag helpers ────────────────────────────────────────────────────────────

  function addTag(value: string) {
    const trimmed = value.trim().toLowerCase();
    if (trimmed && !tags.includes(trimmed)) {
      setTags((prev) => [...prev, trimmed]);
    }
    setTagInput("");
  }

  function removeTag(tag: string) {
    setTags((prev) => prev.filter((t) => t !== tag));
  }

  function handleTagKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(tagInput);
    } else if (e.key === "Backspace" && !tagInput && tags.length > 0) {
      setTags((prev) => prev.slice(0, -1));
    }
  }

  // ── submit ─────────────────────────────────────────────────────────────────

  function handleSubmit(values: ClientProfileFields) {
    mutation.mutate({ ...values, negativeKeywords: tags });
  }

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-stone-950/45 backdrop-blur-sm dark:bg-stone-950/70" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[min(92vw,760px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[2rem] border border-stone-900/10 bg-[#f8f3eb] p-6 shadow-[0_30px_80px_rgba(0,0,0,0.22)] dark:border-stone-700/60 dark:bg-stone-900 dark:shadow-[0_30px_80px_rgba(0,0,0,0.6)]">
          {/* header */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="font-[Cormorant_Garamond] text-3xl font-semibold text-stone-950 dark:text-stone-100">
                Edytuj klienta
              </Dialog.Title>
              <Dialog.Description className="mt-2 text-sm text-stone-600 dark:text-stone-400">
                {client?.companyName} — zmień profil i wykluczenia branżowe.
              </Dialog.Description>
            </div>
            <Dialog.Close className="rounded-full border border-stone-900/10 p-2 text-stone-600 transition hover:bg-white dark:border-stone-700 dark:text-stone-400 dark:hover:bg-stone-800">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          {/* form */}
          <form
            className="mt-8 grid gap-4 md:grid-cols-2"
            onSubmit={form.handleSubmit(handleSubmit)}
          >
            {/* Company name */}
            <Field
              label="Nazwa firmy"
              error={form.formState.errors.companyName?.message}
              className="md:col-span-2"
            >
              <input
                {...form.register("companyName")}
                className={inputClass(form.formState.errors.companyName?.message)}
              />
            </Field>

            {/* Industry */}
            <Field
              label="Branża"
              error={form.formState.errors.industry?.message}
            >
              <input
                {...form.register("industry")}
                className={inputClass(form.formState.errors.industry?.message)}
                placeholder="np. budownictwo ogólne"
              />
            </Field>

            {/* Geographic scope */}
            <Field label="Zasięg geograficzny">
              <select
                {...form.register("geographicScope")}
                className={inputClass()}
              >
                <option value="NATIONAL">Cała Polska</option>
                <option value="REGIONAL">Regionalny</option>
                <option value="LOCAL">Lokalny</option>
              </select>
            </Field>

            {/* Geographic details */}
            <Field
              label="Szczegóły lokalizacji"
              error={form.formState.errors.geographicDetails?.message}
              className="md:col-span-2"
            >
              <input
                {...form.register("geographicDetails")}
                className={inputClass(
                  form.formState.errors.geographicDetails?.message,
                )}
                placeholder="np. woj. mazowieckie, śląskie"
              />
            </Field>

            {/* Budget */}
            <Field
              label="Budżet / Zakres zleceń"
              error={form.formState.errors.budgetDescription?.message}
              className="md:col-span-2"
            >
              <input
                {...form.register("budgetDescription")}
                className={inputClass(
                  form.formState.errors.budgetDescription?.message,
                )}
                placeholder="np. 100 000 – 2 000 000 PLN"
              />
            </Field>

            {/* Contact person */}
            <Field
              label="Osoba kontaktowa"
              error={form.formState.errors.contactPersonName?.message}
            >
              <input
                {...form.register("contactPersonName")}
                className={inputClass(
                  form.formState.errors.contactPersonName?.message,
                )}
              />
            </Field>

            <Field
              label="Stanowisko"
              error={form.formState.errors.contactPersonRole?.message}
            >
              <input
                {...form.register("contactPersonRole")}
                className={inputClass(
                  form.formState.errors.contactPersonRole?.message,
                )}
              />
            </Field>

            {/* ── Negative keywords ─────────────────────────────────────────── */}
            <div className="md:col-span-2">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium uppercase tracking-[0.2em] text-stone-500 dark:text-stone-400">
                  Wykluczenia
                </span>
                <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-medium text-rose-700 dark:bg-rose-900/30 dark:text-rose-400">
                  obniżają scoring dopasowań
                </span>
              </div>
              <p className="mb-3 text-xs leading-relaxed text-stone-500 dark:text-stone-400">
                Podaj słowa kluczowe, które <strong className="text-stone-700 dark:text-stone-300">nie pasują</strong> do klienta.
                Ogłoszenia zawierające wykluczone hasło otrzymają znacznie niższy
                scoring i trafią na koniec listy.
              </p>

              {/* Tags */}
              {tags.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-3 py-1 text-sm font-medium text-rose-800 dark:bg-rose-900/30 dark:text-rose-300"
                    >
                      {tag}
                      <button
                        type="button"
                        onClick={() => removeTag(tag)}
                        className="ml-0.5 rounded-full p-0.5 text-rose-500 transition hover:bg-rose-200 hover:text-rose-700 dark:text-rose-400 dark:hover:bg-rose-900/50"
                        aria-label={`Usuń wykluczenie: ${tag}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {/* Input row */}
              <div className="flex gap-2">
                <input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={handleTagKeyDown}
                  placeholder="np. termomodernizacja — Enter lub przecinek, aby dodać"
                  className="min-h-12 flex-1 rounded-2xl border border-stone-900/10 bg-white px-4 text-sm outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-200 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100 dark:placeholder-stone-500 dark:focus:border-rose-600 dark:focus:ring-rose-900/50"
                />
                <button
                  type="button"
                  onClick={() => addTag(tagInput)}
                  disabled={!tagInput.trim()}
                  className="rounded-full bg-rose-100 px-4 text-sm font-medium text-rose-800 transition hover:bg-rose-200 disabled:opacity-40 dark:bg-rose-900/30 dark:text-rose-300 dark:hover:bg-rose-900/50"
                >
                  Dodaj
                </button>
              </div>

              {tags.length === 0 && (
                <p className="mt-2 text-xs text-stone-400 dark:text-stone-500">
                  Brak wykluczeń — wszystkie ogłoszenia są traktowane jednakowo.
                </p>
              )}
            </div>

            {/* ── Actions ───────────────────────────────────────────────────── */}
            <div className="mt-2 flex justify-end gap-3 md:col-span-2">
              <Dialog.Close className="rounded-full border border-stone-900/10 px-5 py-2 text-sm text-stone-700 transition hover:bg-white dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800">
                Anuluj
              </Dialog.Close>
              <button
                type="submit"
                disabled={mutation.isPending}
                className="rounded-full bg-stone-950 px-5 py-2 text-sm font-medium text-stone-50 transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-amber-700 dark:hover:bg-amber-600"
              >
                {mutation.isPending ? "Zapisywanie…" : "Zapisz i przelicz"}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ── helpers ──────────────────────────────────────────────────────────────────

function Field({
  label,
  error,
  className,
  children,
}: {
  label: string;
  error?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label
      className={cn(
        "grid gap-2 text-sm text-stone-700 dark:text-stone-300",
        className,
      )}
    >
      <span className="font-medium uppercase tracking-[0.2em] text-stone-500 dark:text-stone-400">
        {label}
      </span>
      {children}
      {error && (
        <span className="text-xs text-rose-600 dark:text-rose-400">
          {error}
        </span>
      )}
    </label>
  );
}

function inputClass(error?: string) {
  return cn(
    "min-h-12 rounded-2xl border px-4 text-sm outline-none transition dark:text-stone-100",
    error
      ? "border-rose-500 bg-rose-50 dark:border-rose-700 dark:bg-rose-950/30"
      : "border-stone-900/10 bg-white dark:border-stone-700 dark:bg-stone-800",
    "focus:border-amber-500 focus:ring-2 focus:ring-amber-200 dark:focus:border-amber-600 dark:focus:ring-amber-900/50",
  );
}
