"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { apiJson } from "@/product/api";
import { isSupabaseBrowserConfigured, supabaseBrowser } from "@/product/supabase-browser";
import { createTeamApi, type TeamApi } from "@/product/team-api";

export type TeamIdentity = {
  api: TeamApi;
  email: string;
  organizationId: string;
  role: "admin" | "user";
  userId?: string;
};

export type SupabaseTeamEntryProps = {
  onReady: (identity: { userId: string; orgId: string }) => void;
};

export function SupabaseTeamEntry({ onReady }: SupabaseTeamEntryProps) {
  const [state, setState] = useState<"loading" | "signed-out" | "onboarding" | "access-required" | "ready" | "error">("loading");
  const [email, setEmail] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [message, setMessage] = useState("");
  const [identity, setIdentity] = useState<TeamIdentity | null>(null);

  async function resolveSession() {
    const { data } = await supabaseBrowser().auth.getSession();
    const session = data.session;
    if (!session) { setIdentity(null); setState("signed-out"); return; }
    const tentativeApi = createTeamApi(session.access_token, "");
    try {
      const response = await tentativeApi<{ user: { organizationId: string; role: string } }>("/api/me");
      const teamId: TeamIdentity = {
        api: createTeamApi(session.access_token, response.user.organizationId),
        email: session.user.email ?? "",
        organizationId: response.user.organizationId,
        role: response.user.role as "admin" | "user",
        userId: session.user.id
      };
      setIdentity(teamId);
      setState("ready");
      onReady?.({ userId: session.user.id, orgId: response.user.organizationId });
    } catch (error) {
      setIdentity(null);
      if (error instanceof Error && error.message.includes("MEMBERSHIP_REQUIRED")) {
        const bootstrap = await tentativeApi<{ bootstrapAllowed: boolean }>("/api/onboarding").catch(() => ({ bootstrapAllowed: false }));
        setState(bootstrap.bootstrapAllowed ? "onboarding" : "access-required");
      } else setState("error");
      setMessage(error instanceof Error ? error.message : "Không thể kết nối Supabase.");
    }
  }

  useEffect(() => {
    resolveSession();
    const { data: listener } = supabaseBrowser().auth.onAuthStateChange(() => { void resolveSession(); });
    return () => listener.subscription.unsubscribe();
  }, []);

  async function sendMagicLink(event: React.FormEvent) {
    event.preventDefault(); setMessage("");
    const { error } = await supabaseBrowser().auth.signInWithOtp({
      email, options: { emailRedirectTo: window.location.origin }
    });
    setMessage(error ? error.message : "Đã gửi link đăng nhập. Mở email và quay lại tool này.");
  }

  async function createOrganization(event: React.FormEvent) {
    event.preventDefault(); setMessage("");
    const { data } = await supabaseBrowser().auth.getSession();
    if (!data.session) return setState("signed-out");
    try {
      const api = createTeamApi(data.session.access_token, "");
      await api("/api/onboarding", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationName })
      });
      await resolveSession();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Không thể tạo organization."); }
  }

  if (state === "ready" && identity) return null;
  if (state === "loading") return <main className="loadingScreen"><RefreshCw className="spin" /><strong>Đang kết nối team workspace…</strong></main>;
  if (state === "onboarding") return (
    <main className="loadingScreen"><section className="sectionCard authCard"><h1>Tạo team workspace</h1><p>Tài khoản này chưa thuộc organization nào. Người tạo đầu tiên sẽ là admin.</p>
      <form onSubmit={createOrganization}><input value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} placeholder="Tên agency / team" required minLength={2} /><button className="primaryAction" type="submit">Tạo organization</button></form>
      {message && <small>{message}</small>}</section></main>
  );
  if (state === "access-required") return (
    <main className="loadingScreen"><section className="sectionCard authCard"><h1>Chờ admin cấp quyền</h1><p>Email này chưa được thêm vào team. Hãy nhờ Admin mở mục <strong>Team</strong>, nhập email và chọn các project bạn được làm việc.</p>
      <button className="secondaryAction" onClick={() => void supabaseBrowser().auth.signOut().then(() => setState("signed-out"))}>Dùng email khác</button>
      {message && <small>{message}</small>}</section></main>
  );
  return (
    <main className="loadingScreen"><section className="sectionCard authCard"><h1>Đăng nhập team workspace</h1><p>Dùng email đã được cấp quyền. Tool gửi magic link, không lưu mật khẩu tại đây.</p>
      <form onSubmit={sendMagicLink}><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@agency.com" required /><button className="primaryAction" type="submit">Gửi link đăng nhập</button></form>
      {message && <small>{message}</small>}</section></main>
  );
}

export default SupabaseTeamEntry;
