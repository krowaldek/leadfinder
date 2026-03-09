import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { X } from "lucide-react";
import { useState, type KeyboardEvent } from "react";
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
import { updateClient } from "@/features/clients/clients-api";

interface ClientEditDialogProps {
  open: boolean;
  client: ClientResponse | null;
  onOpenChange: (open: boolean) => void;
}

export function ClientEditDialog({ open, client, onOpenChange }: ClientEditDialogProps) {
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
      toast.success("Profil zaktualizowany. Dopasowania zostaną przeliczone w tle.");
      onOpenChange(false);
    },
    onError: () => toast.error("Nie udało się zapisać zmian"),
  });

  function addTag(value: string) {
    const trimmed = value.trim().toLowerCase();
    if (trimmed && !tags.includes(trimmed)) setTags((prev) => [...prev, trimmed]);
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

  function handleSubmit(values: ClientProfileFields) {
    mutation.mutate({ ...values, negativeKeywords: tags });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edytuj klienta</DialogTitle>
          <DialogDescription>
            {client?.companyName} — zmień profil i wykluczenia branżowe.
          </DialogDescription>
        </DialogHeader>

        <form className="grid gap-4 py-2" onSubmit={form.handleSubmit(handleSubmit)}>
          <div className="grid gap-2">
            <Label htmlFor="companyName">Nazwa firmy</Label>
            <Input
              id="companyName"
              {...form.register("companyName")}
              aria-invalid={!!form.formState.errors.companyName}
            />
            {form.formState.errors.companyName && (
              <p className="text-xs text-destructive">{form.formState.errors.companyName.message}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="industry">Branża</Label>
              <Input
                id="industry"
                {...form.register("industry")}
                placeholder="np. budownictwo ogólne"
                aria-invalid={!!form.formState.errors.industry}
              />
              {form.formState.errors.industry && (
                <p className="text-xs text-destructive">{form.formState.errors.industry.message}</p>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="geographicScope">Zasięg geograficzny</Label>
              <select
                id="geographicScope"
                {...form.register("geographicScope")}
                className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <option value="NATIONAL">Cała Polska</option>
                <option value="REGIONAL">Regionalny</option>
                <option value="LOCAL">Lokalny</option>
              </select>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="geographicDetails">Szczegóły lokalizacji</Label>
            <Input
              id="geographicDetails"
              {...form.register("geographicDetails")}
              placeholder="np. woj. mazowieckie, śląskie"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="budgetDescription">Budżet / Zakres zleceń</Label>
            <Input
              id="budgetDescription"
              {...form.register("budgetDescription")}
              placeholder="np. 100 000 – 2 000 000 PLN"
              aria-invalid={!!form.formState.errors.budgetDescription}
            />
            {form.formState.errors.budgetDescription && (
              <p className="text-xs text-destructive">{form.formState.errors.budgetDescription.message}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="contactPersonName">Osoba kontaktowa</Label>
              <Input id="contactPersonName" {...form.register("contactPersonName")} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="contactPersonRole">Stanowisko</Label>
              <Input id="contactPersonRole" {...form.register("contactPersonRole")} />
            </div>
          </div>

          {/* Negative keywords */}
          <div className="grid gap-2">
            <div className="flex items-center gap-2">
              <Label>Wykluczenia</Label>
              <span className="rounded-md border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                obniżają scoring dopasowań
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Ogłoszenia zawierające wykluczone hasło otrzymają znacznie niższy scoring.
              Wpisz frazę i naciśnij Enter lub przecinek.
            </p>

            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 rounded-full border border-destructive/30 bg-destructive/10 px-2.5 py-0.5 text-xs font-medium text-destructive"
                  >
                    {tag}
                    <button
                      type="button"
                      onClick={() => removeTag(tag)}
                      className="ml-0.5 rounded-full p-0.5 hover:bg-destructive/20"
                      aria-label={`Usuń: ${tag}`}
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <Input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleTagKeyDown}
                placeholder="np. termomodernizacja"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => addTag(tagInput)}
                disabled={!tagInput.trim()}
              >
                Dodaj
              </Button>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Anuluj
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Zapisywanie…" : "Zapisz i przelicz"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}


interface ClientEditDialogProps {
  open: boolean;
  client: ClientResponse | null;
  onOpenChange: (open: boolean) => void;
}

