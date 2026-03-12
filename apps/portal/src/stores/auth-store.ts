import { create } from "zustand";
import { AuthUser } from "@leadfinder/contracts";

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  setSession: (session: { user: AuthUser; accessToken: string }) => void;
  updateUser: (user: AuthUser) => void;
  clearSession: () => void;
}

export const useAuthStore = create<AuthState>()((set) => ({
  user: null,
  accessToken: null,
  setSession: ({ user, accessToken }) => {
    set({ user, accessToken });
  },
  updateUser: (user) => set((state) => ({ ...state, user })),
  clearSession: () => {
    set({ user: null, accessToken: null });
  },
}));

export function getAuthSnapshot() {
  return useAuthStore.getState();
}
