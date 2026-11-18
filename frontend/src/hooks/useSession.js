import { useQuery } from "@tanstack/react-query";
import { getMe } from "../services/endpoints";

export function useSession() {
  const q = useQuery({ queryKey: ["me"], queryFn: getMe });
  const role = q.data?.membership?.role;
  return {
    isLoading: q.isLoading,
    error: q.error,
    refetch: q.refetch,
    session: q.data,
    role,
    isAdmin: role === "admin",
    permissions: q.data?.permissions ?? {},
  };
}