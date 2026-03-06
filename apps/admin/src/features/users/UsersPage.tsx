import { UserDialog } from "@/components/UserDialog";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";
import {
  type AuthUser,
  type CreateUserInput,
  type UpdateUserInput,
} from "@leadfinder/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { motion } from "framer-motion";
import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  DataTable,
  type ColumnDef,
  type RowAction,
} from "../../../components/data-table";
import {
  createUser,
  fetchUsers,
  updateUser,
  updateUserStatus,
} from "./users-api";

const PAGE_SIZE = 20;

export function UsersPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [dialogMode, setDialogMode] = useState<"create" | "edit">("create");
  const [selectedUser, setSelectedUser] = useState<AuthUser | null>(null);
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((state) => state.user);

  const usersQuery = useQuery({
    queryKey: ["users", search, page, PAGE_SIZE],
    queryFn: () => fetchUsers(search, page, PAGE_SIZE),
  });

  const createMutation = useMutation({
    mutationFn: createUser,
    onSuccess: () => {
      toast.success("Uzytkownik zostal dodany");
      void queryClient.invalidateQueries({ queryKey: ["users"] });
      setOpen(false);
    },
    onError: () => toast.error("Nie udalo sie dodac uzytkownika"),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateUserInput }) =>
      updateUser(id, payload),
    onSuccess: () => {
      toast.success("Dane uzytkownika zostaly zaktualizowane");
      void queryClient.invalidateQueries({ queryKey: ["users"] });
      setOpen(false);
      setSelectedUser(null);
    },
    onError: () => toast.error("Nie udalo sie zaktualizowac uzytkownika"),
  });

  const statusMutation = useMutation({
    mutationFn: ({
      id,
      status,
    }: {
      id: string;
      status: "ACTIVE" | "INACTIVE";
    }) => updateUserStatus(id, { status }),
    onSuccess: () => {
      toast.success("Status uzytkownika zostal zaktualizowany");
      void queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: () => toast.error("Nie udalo sie zaktualizowac statusu"),
  });

  const users = usersQuery.data?.data ?? [];
  const meta = usersQuery.data?.meta;

  const stats = useMemo(
    () => ({
      total: meta?.total ?? 0,
      active: users.filter((user) => user.status === "ACTIVE").length,
      company: users.filter((user) => user.accountType === "COMPANY").length,
    }),
    [meta?.total, users],
  );

  const columns = useMemo<ColumnDef<AuthUser>[]>(
    () => [
      {
        id: "user",
        header: "Dane",
        accessorFn: (user) => user,
        cell: ({ row }) => (
          <div>
            <div className="font-medium text-stone-950">{row.fullName}</div>
            <div className="mt-1 text-stone-500">{row.email}</div>
            {row.companyName ? (
              <div className="mt-1 text-xs uppercase tracking-[0.18em] text-amber-800">
                {row.companyName}
              </div>
            ) : null}
          </div>
        ),
      },
      {
        id: "role",
        header: "Rola",
        accessorFn: (user) => user.systemRole,
        cell: ({ row }) => (
          <Tag tone="dark">
            {row.systemRole === "SUPER_ADMIN"
              ? "Super administrator"
              : "Administrator"}
          </Tag>
        ),
      },
      {
        id: "accountType",
        header: "Konto",
        accessorFn: (user) => user.accountType,
        cell: ({ row }) => (
          <Tag tone={row.accountType === "COMPANY" ? "amber" : "stone"}>
            {row.accountType === "COMPANY" ? "Firmowe" : "Osobiste"}
          </Tag>
        ),
      },
      {
        id: "status",
        header: "Status",
        accessorFn: (user) => user.status,
        cell: ({ row }) => (
          <Tag tone={row.status === "ACTIVE" ? "forest" : "rose"}>
            {row.status === "ACTIVE" ? "Aktywny" : "Nieaktywny"}
          </Tag>
        ),
      },
      {
        id: "createdAt",
        header: "Utworzono",
        accessorFn: (user) => format(new Date(user.createdAt), "dd MMM yyyy"),
      },
    ],
    [],
  );

  const rowActions = useMemo<RowAction<AuthUser>[]>(
    () => [
      {
        id: "edit",
        label: "Edytuj",
        onClick: (user) => {
          setDialogMode("edit");
          setSelectedUser(user);
          setOpen(true);
        },
      },
      {
        id: "deactivate",
        label: "Dezaktywuj",
        hidden: (user) => user.status !== "ACTIVE",
        disabled: (user) =>
          statusMutation.isPending || currentUser?.id === user.id,
        onClick: (user) => {
          statusMutation.mutate({
            id: user.id,
            status: "INACTIVE",
          });
        },
      },
      {
        id: "activate",
        label: "Aktywuj",
        hidden: (user) => user.status !== "INACTIVE",
        disabled: () => statusMutation.isPending,
        onClick: (user) => {
          statusMutation.mutate({
            id: user.id,
            status: "ACTIVE",
          });
        },
      },
    ],
    [currentUser?.id, statusMutation.isPending, statusMutation],
  );

  return (
    <div className="grid gap-6">
      <section className="grid min-w-0 gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="min-w-0 rounded-[2rem] border border-stone-900/10 bg-[#fcfaf6] p-6 dark:border-stone-700/60 dark:bg-stone-800/60"
        >
          <p className="text-xs uppercase tracking-[0.35em] text-stone-500 dark:text-stone-400">
            Zarzadzanie uzytkownikami
          </p>
          <h3 className="mt-4 max-w-2xl font-[Cormorant_Garamond] text-4xl font-semibold text-stone-950 dark:text-stone-100">
            Wszystkie konta administratorow i uzytkownikow sa zarzadzane w
            jednym miejscu.
          </h3>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-stone-600 dark:text-stone-400">
            Dodawaj, edytuj i aktywuj konta bez opuszczania panelu
            administracyjnego.
          </p>
        </motion.div>

        <div className="grid min-w-0 gap-4 md:grid-cols-3 xl:grid-cols-1 xl:grid-rows-3">
          <StatCard
            label="Liczba uzytkownikow"
            value={String(stats.total)}
            accent="stone"
          />
          <StatCard
            label="Konta aktywne"
            value={String(stats.active)}
            accent="amber"
          />
          <StatCard
            label="Konta firmowe"
            value={String(stats.company)}
            accent="forest"
          />
        </div>
      </section>

      <DataTable
        data={users}
        columns={columns}
        rowActions={rowActions}
        isLoading={usersQuery.isLoading}
        loadingMessage="Ladowanie uzytkownikow..."
        searchEnabled
        searchValue={search}
        searchPlaceholder="Szukaj po imieniu, emailu lub nazwie firmy"
        onSearchChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        addButton={{
          label: "Dodaj uzytkownika",
          onClick: () => {
            setDialogMode("create");
            setSelectedUser(null);
            setOpen(true);
          },
        }}
        pagination={{
          enabled: true,
          currentPage: meta?.page ?? page,
          pageSize: meta?.limit ?? PAGE_SIZE,
          totalItems: meta?.total ?? 0,
          onPageChange: (nextPage) => setPage(nextPage),
        }}
        emptyState={{
          title: "Brak uzytkownikow dla podanych kryteriow.",
        }}
      />

      <UserDialog
        open={open}
        mode={dialogMode}
        initialUser={selectedUser}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) {
            setSelectedUser(null);
          }
        }}
        onSubmit={async (values) => {
          if (dialogMode === "create") {
            await createMutation.mutateAsync(values as CreateUserInput);
          } else if (selectedUser) {
            await updateMutation.mutateAsync({
              id: selectedUser.id,
              payload: values as UpdateUserInput,
            });
          }
        }}
        isPending={createMutation.isPending || updateMutation.isPending}
      />
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: "stone" | "amber" | "forest";
}) {
  const accentClass = {
    stone:
      "from-stone-950 to-stone-800 text-stone-50 dark:from-stone-800 dark:to-stone-700",
    amber:
      "from-amber-300 to-amber-100 text-amber-950 dark:from-amber-700 dark:to-amber-900 dark:text-amber-100",
    forest:
      "from-emerald-300 to-emerald-100 text-emerald-950 dark:from-emerald-800 dark:to-emerald-950 dark:text-emerald-100",
  }[accent];

  return (
    <div
      className={cn(
        "rounded-[1.6rem] bg-gradient-to-br p-5 shadow-sm",
        accentClass,
      )}
    >
      <p className="text-xs uppercase tracking-[0.28em] opacity-70">{label}</p>
      <p className="mt-4 font-[Cormorant_Garamond] text-5xl font-semibold">
        {value}
      </p>
    </div>
  );
}

function Tag({
  children,
  tone,
}: {
  children: ReactNode;
  tone: "stone" | "dark" | "amber" | "forest" | "rose";
}) {
  const toneClass = {
    stone: "bg-stone-100 text-stone-700 dark:bg-stone-700 dark:text-stone-300",
    dark: "bg-stone-900 text-stone-100 dark:bg-stone-700 dark:text-stone-100",
    amber:
      "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-300",
    forest:
      "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-300",
    rose: "bg-rose-100 text-rose-900 dark:bg-rose-900/40 dark:text-rose-300",
  }[tone];

  return (
    <span
      className={cn(
        "inline-flex rounded-full px-3 py-1 text-xs uppercase tracking-[0.18em]",
        toneClass,
      )}
    >
      {children}
    </span>
  );
}
