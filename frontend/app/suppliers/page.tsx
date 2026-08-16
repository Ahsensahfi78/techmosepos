"use client";

import { useAuth } from "@/lib/auth-context";
import PartyManager from "@/components/PartyManager";

export default function SuppliersPage() {
  const { user } = useAuth();
  const canManage =
    user?.role === "super_admin" ||
    user?.role === "admin" ||
    user?.role === "manager";

  return <PartyManager type="supplier" canManage={canManage} />;
}
