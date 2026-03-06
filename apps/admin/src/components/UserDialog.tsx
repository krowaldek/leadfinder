import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  accountTypeSchema,
  systemRoleSchema,
  userStatusSchema,
  type AuthUser,
  type CreateUserInput,
} from "@leadfinder/contracts";
import { cn } from "@/lib/utils";

const formSchema = z
  .object({
    email: z.email(),
    firstName: z.string().trim().min(1),
    lastName: z.string().trim().min(1),
    password: z.string().min(8).optional(),
    systemRole: systemRoleSchema,
    accountType: accountTypeSchema,
    companyName: z.string().trim().nullable().optional(),
    status: userStatusSchema,
  })
  .superRefine((value, ctx) => {
    if (value.accountType === "COMPANY" && !value.companyName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["companyName"],
        message: "Nazwa firmy jest wymagana dla kont firmowych.",
      });
    }

    if (!value.password) {
      return;
    }

    if (value.password.length < 8) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["password"],
        message: "Haslo musi miec co najmniej 8 znakow.",
      });
    }
  });

type FormValues = z.infer<typeof formSchema>;

interface UserDialogProps {
  open: boolean;
  mode: "create" | "edit";
  initialUser?: AuthUser | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: CreateUserInput | Omit<FormValues, "email" | "password">) => Promise<void>;
  isPending: boolean;
}

export function UserDialog({
  open,
  mode,
  initialUser,
  onOpenChange,
  onSubmit,
  isPending,
}: UserDialogProps) {
  const isEdit = mode === "edit";

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: initialUser?.email ?? "",
      firstName: initialUser?.firstName ?? "",
      lastName: initialUser?.lastName ?? "",
      password: "",
      systemRole: initialUser?.systemRole ?? "ADMIN",
      accountType: initialUser?.accountType ?? "PERSONAL",
      companyName: initialUser?.companyName ?? "",
      status: initialUser?.status ?? "ACTIVE",
    },
    values: {
      email: initialUser?.email ?? "",
      firstName: initialUser?.firstName ?? "",
      lastName: initialUser?.lastName ?? "",
      password: "",
      systemRole: initialUser?.systemRole ?? "ADMIN",
      accountType: initialUser?.accountType ?? "PERSONAL",
      companyName: initialUser?.companyName ?? "",
      status: initialUser?.status ?? "ACTIVE",
    },
  });

  const accountType = form.watch("accountType");

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-stone-950/45 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,720px)] -translate-x-1/2 -translate-y-1/2 rounded-[2rem] border border-stone-900/10 bg-[#f8f3eb] p-6 shadow-[0_30px_80px_rgba(0,0,0,0.22)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="font-[Cormorant_Garamond] text-3xl font-semibold text-stone-950">
                {isEdit ? "Edytuj uzytkownika" : "Dodaj uzytkownika"}
              </Dialog.Title>
              <Dialog.Description className="mt-2 text-sm text-stone-600">
                Uzupelnij dane konta oraz poziom dostepu w panelu administracyjnym.
              </Dialog.Description>
            </div>
            <Dialog.Close className="rounded-full border border-stone-900/10 p-2 text-stone-600 transition hover:bg-white">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          <form
            className="mt-8 grid gap-4 md:grid-cols-2"
            onSubmit={form.handleSubmit(async (values) => {
              if (isEdit) {
                await onSubmit({
                  firstName: values.firstName,
                  lastName: values.lastName,
                  systemRole: values.systemRole,
                  accountType: values.accountType,
                  companyName:
                    values.accountType === "COMPANY" ? (values.companyName ?? null) : null,
                  status: values.status,
                });
              } else {
                await onSubmit({
                  email: values.email,
                  firstName: values.firstName,
                  lastName: values.lastName,
                  password: values.password ?? "",
                  systemRole: values.systemRole,
                  accountType: values.accountType,
                  companyName:
                    values.accountType === "COMPANY" ? (values.companyName ?? null) : null,
                  status: values.status,
                });
              }
            })}
          >
            <Field
              label="Email"
              error={form.formState.errors.email?.message}
              className="md:col-span-2"
            >
              <input
                {...form.register("email")}
                disabled={isEdit}
                className={inputClass(form.formState.errors.email?.message, isEdit)}
                placeholder="admin@leadfinder.local"
              />
            </Field>

            <Field label="Imie" error={form.formState.errors.firstName?.message}>
              <input
                {...form.register("firstName")}
                className={inputClass(form.formState.errors.firstName?.message)}
              />
            </Field>

            <Field label="Nazwisko" error={form.formState.errors.lastName?.message}>
              <input
                {...form.register("lastName")}
                className={inputClass(form.formState.errors.lastName?.message)}
              />
            </Field>

            {!isEdit ? (
              <Field label="Haslo" error={form.formState.errors.password?.message}>
                <input
                  type="password"
                  {...form.register("password")}
                  className={inputClass(form.formState.errors.password?.message)}
                />
              </Field>
            ) : null}

            <Field label="Rola systemowa">
              <select {...form.register("systemRole")} className={inputClass()}>
                <option value="ADMIN">Administrator</option>
                <option value="SUPER_ADMIN">Super administrator</option>
              </select>
            </Field>

            <Field label="Typ konta">
              <select {...form.register("accountType")} className={inputClass()}>
                <option value="PERSONAL">Osobiste</option>
                <option value="COMPANY">Firmowe</option>
              </select>
            </Field>

            <Field label="Status">
              <select {...form.register("status")} className={inputClass()}>
                <option value="ACTIVE">Aktywny</option>
                <option value="INACTIVE">Nieaktywny</option>
              </select>
            </Field>

            {accountType === "COMPANY" ? (
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
            ) : null}

            <div className="mt-2 flex justify-end gap-3 md:col-span-2">
              <Dialog.Close className="rounded-full border border-stone-900/10 px-5 py-2 text-sm text-stone-700 transition hover:bg-white">
                Anuluj
              </Dialog.Close>
              <button
                type="submit"
                disabled={isPending}
                className="rounded-full bg-stone-950 px-5 py-2 text-sm font-medium text-stone-50 transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isPending ? "Zapisywanie..." : isEdit ? "Zapisz zmiany" : "Dodaj uzytkownika"}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

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
    <label className={cn("grid gap-2 text-sm text-stone-700", className)}>
      <span className="font-medium uppercase tracking-[0.2em] text-stone-500">{label}</span>
      {children}
      {error ? <span className="text-xs text-rose-600">{error}</span> : null}
    </label>
  );
}

function inputClass(error?: string, disabled?: boolean) {
  return cn(
    "min-h-12 rounded-2xl border px-4 text-sm outline-none transition",
    error ? "border-rose-500 bg-rose-50" : "border-stone-900/10 bg-white",
    disabled
      ? "cursor-not-allowed bg-stone-100 text-stone-500"
      : "focus:border-amber-500 focus:ring-2 focus:ring-amber-200",
  );
}
