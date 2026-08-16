"use client";

import { useAuth } from "@/lib/auth-context";
import PartyManager from "@/components/PartyManager";

export default function CustomersPage() {
  const { user } = useAuth();
  const canManage =
    user?.role === "super_admin" ||
    user?.role === "admin" ||
    user?.role === "manager" ||
    user?.role === "cashier";

  return <PartyManager type="customer" canManage={canManage} />;
}
