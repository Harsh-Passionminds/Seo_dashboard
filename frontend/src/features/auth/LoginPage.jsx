import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { login, changePassword, googleLoginUrl } from "../../services/endpoints";

const Card = ({ title, children }) => (
  <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
    <div className="w-full max-w-sm space-y-4 rounded-lg border bg-white p-6">
      <h1 className="text-lg font-semibold">{title}</h1>
      {children}
    </div>
  </div>
);

export function LoginPage() {
  const qc = useQueryClient();
  const [f, setF] = useState({ username: "", password: "" });
  const m = useMutation({
    mutationFn: () => login({ username: f.username.trim(), password: f.password }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });

  return (
    <Card title="SEO Analytics">
      <button className="w-full rounded bg-blue-600 px-4 py-2 text-sm text-white"
        onClick={() => window.location.assign(googleLoginUrl())}>
        Admin sign in with Google
      </button>
      <div className="text-center text-xs text-gray-400">or employee sign in</div>
      <form onSubmit={(e) => { e.preventDefault(); m.mutate(); }} className="space-y-3">
        <input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })}
          placeholder="Username" autoComplete="username" className="w-full rounded border px-3 py-2 text-sm" />
        <input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })}
          placeholder="Password" autoComplete="current-password" className="w-full rounded border px-3 py-2 text-sm" />
        {m.error && <p className="text-sm text-red-700">{m.error.message}</p>}
        <button disabled={m.isPending || !f.username || !f.password}
          className="w-full rounded border px-4 py-2 text-sm disabled:opacity-50">
          {m.isPending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </Card>
  );
}

export function ChangePasswordPage() {
  const qc = useQueryClient();
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [err, setErr] = useState("");
  const m = useMutation({
    mutationFn: () => changePassword(p1),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });

  const submit = (e) => {
    e.preventDefault();
    if (p1.length < 12) return setErr("Password must be at least 12 characters.");
    if (new TextEncoder().encode(p1).length > 72) return setErr("Password must be at most 72 bytes.");
    if (p1 !== p2) return setErr("Passwords do not match.");
    setErr("");
    m.mutate();
  };

  return (
    <Card title="Set a new password">
      <p className="text-sm text-gray-600">You signed in with a temporary password. Choose a new one to continue.</p>
      <form onSubmit={submit} className="space-y-3">
        <input type="password" value={p1} onChange={(e) => setP1(e.target.value)} placeholder="New password"
          autoComplete="new-password" className="w-full rounded border px-3 py-2 text-sm" />
        <input type="password" value={p2} onChange={(e) => setP2(e.target.value)} placeholder="Confirm new password"
          autoComplete="new-password" className="w-full rounded border px-3 py-2 text-sm" />
        {(err || m.error) && <p className="text-sm text-red-700">{err || m.error.message}</p>}
        <button disabled={m.isPending} className="w-full rounded bg-blue-600 px-4 py-2 text-sm text-white">
          {m.isPending ? "Saving…" : "Save password"}
        </button>
      </form>
    </Card>
  );
}