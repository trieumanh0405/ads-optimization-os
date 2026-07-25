"use client";

import { useMemo, useState } from "react";
import { Bot, Check, KeyRound, Plus, Send, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import { sumFacts } from "@/core/metrics";
import type { ActionRecord } from "@/core/actions";
import type { AiInsight } from "@/ai/contracts";
import { BUILT_IN_PLAYBOOKS } from "@/ai/playbooks";
import { apiJson } from "@/product/api";
import type { AiAnalysisRecord, AiProviderDraft, LocalProject } from "@/product/types";

type Props = {
  project: LocalProject;
  providers: AiProviderDraft[];
  selectedPlaybookIds: string[];
  analyses: AiAnalysisRecord[];
  onProvidersChange: (providers: AiProviderDraft[]) => void;
  onPlaybooksChange: (ids: string[]) => void;
  onAnalysis: (analysis: AiAnalysisRecord) => void;
  notify: (message: string, tone?: "success" | "error") => void;
};

function actionEntityMatches(action: ActionRecord, fact: LocalProject["facts"][number]): boolean {
  if (action.entityLevel === "CAMPAIGN") return fact.entityLevel === "CAMPAIGN" && fact.campaignId === action.entityId;
  if (action.entityLevel === "ADSET") return fact.entityLevel === "ADSET" && fact.adsetId === action.entityId;
  return fact.entityLevel === "AD" && fact.adId === action.entityId;
}

function ratio(numerator: number | null, denominator: number | null, multiplier = 1): number | null {
  if (numerator === null || denominator === null || denominator === 0) return null;
  return (numerator / denominator) * multiplier;
}

function buildSnapshot(project: LocalProject, action: ActionRecord) {
  const facts = project.facts.filter((fact) => actionEntityMatches(action, fact));
  const totals = sumFacts(facts);
  const latest = [...facts].sort((a, b) => b.date.localeCompare(a.date))[0];
  const metrics: Record<string, number | null> = {
    spend: totals.spend,
    result: totals.result,
    qualifiedResult: totals.qualifiedResult,
    revenue: totals.revenue,
    impressions: totals.impressions,
    clicks: totals.clicks,
    cpm: ratio(totals.spend, totals.impressions, 1000),
    cpc: ratio(totals.spend, totals.clicks),
    ctr: ratio(totals.clicks, totals.impressions, 100),
    cvr: ratio(totals.result, totals.clicks, 100),
    roas: ratio(totals.revenue, totals.spend),
    ...totals.metrics
  };
  const dimensions: Record<string, string | null> = {
    objective: latest?.objective ?? null,
    optimizationGoal: latest?.optimizationGoal ?? null,
    learningStatus: latest?.learningStatus ?? null,
    postId: latest?.postId ?? null,
    ...(latest?.dimensions ?? {})
  };
  return { metrics, dimensions };
}

export function AiAnalysisPanel({
  project,
  providers,
  selectedPlaybookIds,
  analyses,
  onProvidersChange,
  onPlaybooksChange,
  onAnalysis,
  notify
}: Props) {
  const [providerId, setProviderId] = useState(providers[0]?.id ?? "");
  const provider = providers.find((item) => item.id === providerId) ?? providers[0];
  const actionOptions = project.actions.filter((action) => action.approvalStatus === "PENDING" || action.approvalStatus === "DEFERRED");
  const [actionId, setActionId] = useState(actionOptions[0]?.id ?? project.actions[0]?.id ?? "");
  const action = project.actions.find((item) => item.id === actionId) ?? actionOptions[0] ?? project.actions[0];
  const [apiKey, setApiKey] = useState(() =>
    typeof window === "undefined" || !provider ? "" : sessionStorage.getItem(`ads-os-key-${provider.id}`) ?? ""
  );
  const [rememberSession, setRememberSession] = useState(false);
  const [busy, setBusy] = useState(false);
  const latestAnalysis = useMemo(
    () => analyses.find((item) => item.projectId === project.config.projectId && item.actionId === action?.id) ?? null,
    [analyses, project.config.projectId, action?.id]
  );

  function updateProvider(patch: Partial<AiProviderDraft>) {
    if (!provider) return;
    onProvidersChange(providers.map((item) => item.id === provider.id ? { ...item, ...patch } : item));
  }

  function addProvider() {
    const next: AiProviderDraft = {
      id: `provider-${crypto.randomUUID().slice(0, 8)}`,
      name: "Custom provider",
      kind: "OPENAI_COMPATIBLE",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4.1-mini"
    };
    onProvidersChange([...providers, next]);
    setProviderId(next.id);
    setApiKey("");
  }

  function removeProvider() {
    if (!provider || providers.length <= 1) return notify("Workspace phải còn ít nhất một provider.", "error");
    if (!window.confirm(`Xóa cấu hình provider "${provider.name}"? API key session cũng sẽ bị quên.`)) return;
    const remaining = providers.filter((item) => item.id !== provider.id);
    sessionStorage.removeItem(`ads-os-key-${provider.id}`);
    onProvidersChange(remaining);
    setProviderId(remaining[0].id);
    setApiKey(sessionStorage.getItem(`ads-os-key-${remaining[0].id}`) ?? "");
  }

  function selectProvider(id: string) {
    setProviderId(id);
    setApiKey(sessionStorage.getItem(`ads-os-key-${id}`) ?? "");
  }

  function togglePlaybook(id: string) {
    onPlaybooksChange(selectedPlaybookIds.includes(id)
      ? selectedPlaybookIds.filter((item) => item !== id)
      : [...selectedPlaybookIds, id]);
  }

  async function analyze() {
    if (!provider) return notify("Chưa có AI provider.", "error");
    if (!action) return notify("Hãy chạy engine để có action trước.", "error");
    if (!apiKey) return notify("Nhập API key cho provider.", "error");
    if (rememberSession) sessionStorage.setItem(`ads-os-key-${provider.id}`, apiKey);
    setBusy(true);
    try {
      const snapshot = buildSnapshot(project, action);
      const response = await apiJson<{ insight: AiInsight }>("/api/ai/direct", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: { ...provider, apiKey },
          playbookIds: selectedPlaybookIds,
          metrics: snapshot.metrics,
          dimensions: snapshot.dimensions,
          deterministicDecision: action,
          projectContext: {
            projectName: project.config.projectName,
            platform: project.config.platform,
            currency: project.config.currency,
            primaryMetricKey: project.config.primaryMetricKey,
            target: project.config.target,
            optimizationEventLabel: project.config.optimizationEventLabel,
            salesModel: project.config.salesModel,
            trackingConfidence: project.config.trackingConfidence,
            capiStatus: project.config.capiStatus,
            timezone: project.config.timezone
          }
        })
      });
      onAnalysis({
        id: crypto.randomUUID(),
        projectId: project.config.projectId,
        actionId: action.id,
        createdAt: new Date().toISOString(),
        providerName: provider.name,
        model: provider.model,
        playbookIds: selectedPlaybookIds,
        insight: response.insight
      });
      notify("AI đã phân tích xong. Deterministic action không bị thay đổi.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "AI analysis thất bại.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="viewStack">
      <section className="sectionCard">
        <div className="sectionHeader">
          <div>
            <span className="sectionKicker">BYOK · MULTI-PROVIDER</span>
            <h2>AI diagnostics</h2>
            <p>AI giải thích supporting metrics và giả thuyết; rule engine vẫn là nguồn action duy nhất.</p>
          </div>
          <div className="headerActions">
            <span className="statusBadge success"><ShieldCheck size={14} /> Key không lưu vào workspace</span>
            <button className="secondaryAction" onClick={addProvider}><Plus size={14} /> Provider</button>
            <button className="iconAction dangerIcon" onClick={removeProvider} aria-label="Xóa provider"><Trash2 size={15} /></button>
          </div>
        </div>
        <div className="formGrid">
          <label>Provider
            <select value={provider?.id ?? ""} onChange={(event) => selectProvider(event.target.value)}>
              {providers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label>Tên provider
            <input value={provider?.name ?? ""} onChange={(event) => updateProvider({ name: event.target.value })} />
          </label>
          <label>Loại API
            <select value={provider?.kind ?? "OPENAI_COMPATIBLE"} onChange={(event) => updateProvider({ kind: event.target.value as AiProviderDraft["kind"] })}>
              <option value="OPENAI_COMPATIBLE">OpenAI compatible</option>
              <option value="ANTHROPIC">Anthropic</option>
              <option value="GEMINI">Gemini</option>
            </select>
          </label>
          <label>Base URL
            <input value={provider?.baseUrl ?? ""} onChange={(event) => updateProvider({ baseUrl: event.target.value })} />
          </label>
          <label>Model
            <input value={provider?.model ?? ""} onChange={(event) => updateProvider({ model: event.target.value })} />
          </label>
          <label className="fullWidth">API key
            <div className="inputWithIcon"><KeyRound size={16} /><input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="Chỉ gửi qua HTTPS cho request phân tích này" /></div>
          </label>
          <label className="checkboxLine fullWidth">
            <input type="checkbox" checked={rememberSession} onChange={(event) => setRememberSession(event.target.checked)} />
            Chỉ nhớ trong tab/session hiện tại; đóng browser sẽ xóa.
          </label>
          <label className="fullWidth">Action cần phân tích
            <select value={action?.id ?? ""} onChange={(event) => setActionId(event.target.value)}>
              {!project.actions.length && <option value="">Chưa có action · hãy chạy engine</option>}
              {project.actions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.entityLevel} · {item.entityName} · {item.recommendedAction} · {item.approvalStatus}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="sectionCard">
        <div className="sectionHeader">
          <div>
            <span className="sectionKicker">VERSIONED PLAYBOOKS</span>
            <h2>Skill phân tích đã tích hợp</h2>
            <p>Chọn nhiều playbook; thiếu metric sẽ được khai báo là limitation thay vì bịa dữ liệu.</p>
          </div>
        </div>
        <div className="playbookGrid">
          {BUILT_IN_PLAYBOOKS.map((playbook) => {
            const active = selectedPlaybookIds.includes(playbook.id);
            return (
              <button key={playbook.id} className={`playbookCard ${active ? "active" : ""}`} onClick={() => togglePlaybook(playbook.id)}>
                <span className="playbookIcon">{active ? <Check size={17} /> : <Bot size={17} />}</span>
                <span>
                  <strong>{playbook.name}</strong>
                  <small>{playbook.source} · v{playbook.version}</small>
                  <p>{playbook.purpose}</p>
                </span>
              </button>
            );
          })}
        </div>
        <div className="cardActions">
          <span className="helperText">API key đi thẳng tới provider qua serverless proxy và không được ghi log/store.</span>
          <button className="primaryAction" disabled={busy || !action} onClick={analyze}>
            {busy ? <Sparkles className="spin" size={16} /> : <Send size={16} />}
            {busy ? "Đang phân tích…" : "Phân tích action"}
          </button>
        </div>
      </section>

      {latestAnalysis && (
        <section className="sectionCard insightResult">
          <div className="sectionHeader">
            <div>
              <span className="sectionKicker">{latestAnalysis.providerName} · {latestAnalysis.model}</span>
              <h2>AI insight</h2>
              <p>{new Date(latestAnalysis.createdAt).toLocaleString("vi-VN")} · Confidence {Math.round(latestAnalysis.insight.confidence * 100)}%</p>
            </div>
            <span className="statusBadge warning"><Sparkles size={14} /> Advisory only</span>
          </div>
          <div className="insightSummary">{latestAnalysis.insight.summary}</div>
          <div className="insightColumns">
            <div>
              <h3>Observations</h3>
              <ul>{latestAnalysis.insight.observations.map((item, index) => <li key={`${item.metric}-${index}`}><strong>{item.metric}</strong> · {item.finding}</li>)}</ul>
            </div>
            <div>
              <h3>Hypotheses</h3>
              <ul>{latestAnalysis.insight.hypotheses.map((item, index) => <li key={index}>{item}</li>)}</ul>
            </div>
            <div>
              <h3>Checks tiếp theo</h3>
              <ul>{latestAnalysis.insight.suggestedChecks.map((item, index) => <li key={index}>{item}</li>)}</ul>
            </div>
          </div>
          <div className="advisoryBox">
            <strong>Commentary cho action</strong>
            <p>{latestAnalysis.insight.actionCommentary}</p>
          </div>
          {latestAnalysis.insight.limitations.length > 0 && (
            <div className="limitationBox">
              <strong>Limitations</strong>
              <ul>{latestAnalysis.insight.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
