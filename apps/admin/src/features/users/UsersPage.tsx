import { UserDialog } from "@/components/UserDialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuthStore } from "@/stores/auth-store";
import {
  type AuthUser,
  type CreateUserInput,
  type UpdateUserInput,
} from "@leadfinder/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { useMemo, useState } from "react";
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
      toast.success("Użytkownik został dodany");
      void queryClient.invalidateQueries({ queryKey: ["users"] });
      setOpen(false);
    },
    onError: () => toast.error("Nie udało się dodać użytkownika"),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateUserInput }) =>
      updateUser(id, payload),
    onSuccess: () => {
      toast.success("Dane użytkownika zostały zaktualizowane");
      void queryClient.invalidateQueries({ queryKey: ["users"] });
      setOpen(false);
      setSelectedUser(null);
    },
    onError: () => toast.error("Nie udało się zaktualizować użytkownika"),
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
      toast.success("Status użytkownika został zaktualizowany");
      void queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: () => toast.error("Nie udało się zaktualizować statusu"),
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
            <div className="font-medium">{row.fullName}</div>
            <div className="mt-0.5 text-sm text-muted-foreground">{row.email}</div>
            {row.companyName && (
              <div className="mt-0.5 text-xs text-muted-foreground">{row.companyName}</div>
            )}
          </div>
        ),
      },
      {
        id: "role",
        header: "Rola",
        accessorFn: (user) => user.systemRole,
        cell: ({ row }) => (
          <Badge variant="secondary">
            {row.systemRole === "SUPER_ADMIN" ? "Super administrator" : "Administrator"}
          </Badge>
        ),
      },
      {
        id: "accountType",
        header: "Konto",
        accessorFn: (user) => user.accountType,
        cell: ({ row }) => (
          <Badge variant="outline">
            {row.accountType === "COMPANY" ? "Firmowe" : "Osobiste"}
          </Badge>
        ),
      },
      {
        id: "status",
        header: "Status",
        accessorFn: (user) => user.status,
        cell: ({ row }) => (
          <Badge variant={row.status === "ACTIVE" ? "default" : "destructive"}>
            {row.status === "ACTIVE" ? "Aktywny" : "Nieaktywny"}
          </Badge>
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
          statusMutation.mutate({ id: user.id, status: "INACTIVE" });
        },
      },
      {
        id: "activate",
        label: "Aktywuj",
        hidden: (user) => user.status !== "INACTIVE",
        disabled: () => statusMutation.isPending,
        onClick: (user) => {
          statusMutation.mutate({ id: user.id, status: "ACTIVE" });
        },
      },
    ],
    [currentUser?.id, statusMutation],
  );

  return (
    <div className="grid gap-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Liczba użytkowników
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">{stats.total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Konta aktywne
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">{stats.active}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Konta firmowe
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">{stats.company}</p>
          </CardContent>
        </Card>
      </div>

      <DataTable
        data={users}
        columns={columns}
        rowActions={rowActions}
        isLoading={usersQuery.isLoading}
        loadingMessage="Ładowanie użytkowników..."
        searchEnabled
        searchValue={search}
        searchPlaceholder="Szukaj po imieniu, emailu lub nazwie firmy"
        onSearchChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        addButton={{
          label: "Dodaj użytkownika",
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
          title: "Brak użytkowników dla podanych kryteriów.",
        }}
      />

      <UserDialog
        open={open}
        mode={dialogMode}
        initialUser={selectedUser}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) setSelectedUser(null);
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

