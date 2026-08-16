"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Logo from "@/components/Logo";
import { useAuth } from "@/lib/auth-context";

interface Field {
  username: string;
  password: string;
}

const emptyField: Field = {
  username: "",
  password: "",
};

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();

  const [field, setField] = useState<Field>(emptyField);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function nextPath(): string {
    const next = new URLSearchParams(window.location.search).get("next");
    if (next && next.startsWith("/") && !next.startsWith("//")) return next;
    return "/";
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (!field.username.trim() || !field.password) {
      setError("Username and password are required.");
      return;
    }

    setBusy(true);
    try {
      await login(field.username.trim(), field.password);
      router.replace(nextPath());
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Sign in failed"
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm animate-fade-up">
        <div className="mb-6 flex justify-center">
          <Logo size={44} />
        </div>

        <div className="card overflow-hidden !p-0">
          <div className="border-b border-slate-100 bg-slate-50 px-6 py-4 text-center">
            <p className="text-sm font-bold text-slate-700">Sign in to TechMOS</p>
            <p className="text-xs text-slate-400">Point of Sale — Staff only</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5 p-6">
            <div>
              <label className="label">Username</label>
              <input
                value={field.username}
                onChange={(e) =>
                  setField((f) => ({ ...f, username: e.target.value }))
                }
                placeholder="admin"
                autoComplete="username"
                autoFocus
                className="input"
              />
            </div>

            <div>
              <label className="label">Password</label>
              <input
                type="password"
                value={field.password}
                onChange={(e) =>
                  setField((f) => ({ ...f, password: e.target.value }))
                }
                placeholder="••••••••"
                autoComplete="current-password"
                className="input"
              />
            </div>

            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-600">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="btn btn-primary w-full"
            >
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>

        <p className="mt-5 text-center text-xs text-slate-400">
          Demo sign-in&nbsp;
          <span className="font-semibold text-slate-500">admin</span>
          {" / "}
          <span className="font-semibold text-slate-500">admin123</span>
        </p>
      </div>
    </div>
  );
}
