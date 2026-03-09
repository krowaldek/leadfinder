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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edytuj użytkownika" : "Dodaj użytkownika"}</DialogTitle>
          <DialogDescription>
            Uzupełnij dane konta oraz poziom dostępu w panelu administracyjnym.
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-4 py-2"
          onSubmit={form.handleSubmit(async (values) => {
            if (isEdit) {
              await onSubmit({
                firstName: values.firstName,
                lastName: values.lastName,
                systemRole: values.systemRole,
                accountType: values.accountType,
                companyName: values.accountType === "COMPANY" ? (values.companyName ?? null) : null,
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
                companyName: values.accountType === "COMPANY" ? (values.companyName ?? null) : null,
                status: values.status,
              });
            }
          })}
        >
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="firstName">Imię</Label>
              <Input
                id="firstName"
                {...form.register("firstName")}
                aria-invalid={!!form.formState.errors.firstName}
              />
              {form.formState.errors.firstName && (
                <p className="text-xs text-destructive">{form.formState.errors.firstName.message}</p>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="lastName">Nazwisko</Label>
              <Input
                id="lastName"
                {...form.register("lastName")}
                aria-invalid={!!form.formState.errors.lastName}
              />
              {form.formState.errors.lastName && (
                <p className="text-xs text-destructive">{form.formState.errors.lastName.message}</p>
              )}
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              {...form.register("email")}
              disabled={isEdit}
              aria-invalid={!!form.formState.errors.email}
              placeholder="admin@leadfinder.local"
            />
            {form.formState.errors.email && (
              <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>
            )}
          </div>

          {!isEdit && (
            <div className="grid gap-2">
              <Label htmlFor="password">Hasło</Label>
              <Input
                id="password"
                type="password"
                {...form.register("password")}
                aria-invalid={!!form.formState.errors.password}
              />
              {form.formState.errors.password && (
                <p className="text-xs text-destructive">{form.formState.errors.password.message}</p>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="systemRole">Rola systemowa</Label>
              <select
                id="systemRole"
                {...form.register("systemRole")}
                className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <option value="ADMIN">Administrator</option>
                <option value="SUPER_ADMIN">Super Admin</option>
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="accountType">Typ konta</Label>
              <select
                id="accountType"
                {...form.register("accountType")}
                className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <option value="PERSONAL">Osobiste</option>
                <option value="COMPANY">Firmowe</option>
              </select>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="status">Status</Label>
            <select
              id="status"
              {...form.register("status")}
              className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <option value="ACTIVE">Aktywny</option>
              <option value="INACTIVE">Nieaktywny</option>
            </select>
          </div>

          {accountType === "COMPANY" && (
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
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Anuluj
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Zapisywanie..." : isEdit ? "Zapisz zmiany" : "Dodaj użytkownika"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}


