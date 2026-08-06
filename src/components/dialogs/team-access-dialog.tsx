import { useEffect, useState } from "react";
import { UsersRound, X } from "lucide-react";
import type { TeamApi } from "@/product/team-api";
import type { LocalProject } from "@/product/types";

export type TeamMemberView = {
  userId: string;
  email: string;
  role: "admin" | "user";
  projectIds: string[];
};

export type TeamAccessDialogProps = {
  open: boolean;
  onClose: () => void;
  teamApi: TeamApi;
  projects: LocalProject[];
  notify?: (message: string, tone?: "success" | "error") => void;
};

export function TeamAccessDialog({
  open,
  onClose,
  teamApi,
  projects,
  notify,
}: TeamAccessDialogProps) {
  const [members, setMembers] = useState<TeamMemberView[]>([]);
  const [email, setEmail] = useState("");
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    async function refresh() {
      setLoading(true);
      try {
        const result = await teamApi<{ members: TeamMemberView[] }>("/api/team/members");
        setMembers(result.members);
      } catch (error) {
        notify?.(error instanceof Error ? error.message : "TEAM_LOAD_FAILED", "error");
      } finally {
        setLoading(false);
      }
    }
    void refresh();
  }, [open, teamApi, notify]);

  if (!open) return null;

  async function refresh() {
    setLoading(true);
    try {
      const result = await teamApi<{ members: TeamMemberView[] }>("/api/team/members");
      setMembers(result.members);
    } catch (error) {
      notify?.(error instanceof Error ? error.message : "TEAM_LOAD_FAILED", "error");
    } finally {
      setLoading(false);
    }
  }

  function toggleProject(projectId: string) {
    setProjectIds((current) =>
      current.includes(projectId)
        ? current.filter((item) => item !== projectId)
        : [...current, projectId]
    );
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim() || projectIds.length === 0) {
      notify?.("Nhập email và chọn ít nhất một project.", "error");
      return;
    }
    setSaving(true);
    try {
      const result = await teamApi<{ invited: boolean }>("/api/team/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, projectIds }),
      });
      notify?.(result.invited ? "Đã gửi email mời và cấp project." : "Đã cập nhật project cho user.");
      setEmail("");
      setProjectIds([]);
      await refresh();
    } catch (error) {
      notify?.(error instanceof Error ? error.message : "TEAM_SAVE_FAILED", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modalBackdrop" role="presentation" onMouseDown={onClose}>
      <section className="productModal wideModal" role="dialog" aria-modal="true" aria-labelledby="team-access-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modalTitle">
          <div><span className="sectionKicker">ADMIN ONLY</span><h2 id="team-access-title">Team & project access</h2><p>Thêm email và chọn brand được thao tác. User có toàn quyền vận hành trên project được giao, nhưng không xóa project của người khác.</p></div>
          <button className="iconAction" onClick={onClose} aria-label="Đóng"><X size={18} /></button>
        </div>
        <form className="teamAccessForm" onSubmit={save}>
          <label>Email user<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="media-buyer@agency.com" required /></label>
          <fieldset><legend>Project được giao</legend>
            {projects.length ? projects.map((project) => <label className="checkboxLine" key={project.config.projectId}>
              <input type="checkbox" checked={projectIds.includes(project.config.projectId)} onChange={() => toggleProject(project.config.projectId)} />
              <span>{project.config.projectName}</span>
            </label>) : <p className="helperText">Tạo project trước rồi cấp quyền cho user.</p>}
          </fieldset>
          <div className="modalActions"><button className="secondaryAction" type="button" onClick={onClose}>Đóng</button><button className="primaryAction" disabled={saving} type="submit"><UsersRound size={16} /> {saving ? "Đang lưu…" : "Mời / cập nhật user"}</button></div>
        </form>
        <div className="teamMemberList" aria-live="polite">
          <strong>Thành viên hiện tại</strong>
          {loading ? <p className="helperText">Đang tải team…</p> : members.map((member) => <button className="teamMemberRow" type="button" key={member.userId} onClick={() => { if (member.role === "user") { setEmail(member.email); setProjectIds(member.projectIds); } }} disabled={member.role === "admin"}>
            <span><strong>{member.email}</strong><small>{member.role === "admin" ? "Admin · tất cả project" : `${member.projectIds.length} project được giao`}</small></span>
            {member.role === "user" && <span className="statusBadge neutral">Sửa quyền</span>}
          </button>)}
        </div>
      </section>
    </div>
  );
}
