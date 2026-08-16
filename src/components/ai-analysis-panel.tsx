"use client";

import { useEffect, useMemo, useState } from "react";
import { Bot, Check, ChevronDown, Search, Send, ShieldCheck, Sparkles } from "lucide-react";
import { sumFacts } from "@/core/metrics";
import type { ActionRecord } from "@/core/actions";
import type { AiInsight } from "@/ai/contracts";
import { BUILT_IN_PLAYBOOKS } from "@/ai/playbooks";
import { apiJson } from "@/product/api";
import type { TeamApi } from "@/product/team-api";
import type { AiAnalysisRecord, AiProviderDraft, LocalProject } from "@/product/types";
import { ProviderDialog, type Provider } from "@/components/provider-dialog";

type Props = {
  project: LocalProject;
  providers: AiProviderDraft[];
  selectedPlaybookIds: string[];
  analyses: AiAnalysisRecord[];
  onProvidersChange: (providers: AiProviderDraft[]) => void;
  onPlaybooksChange: (ids: string[]) => void;
  onAnalysis: (analysis: AiAnalysisRecord) => void;
  notify: (message: string, tone?: "success" | "error") => void;
  teamApi: TeamApi | null;
  isAdmin: boolean;
  initialActionId?: string | null;
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
  notify,
  teamApi,
  isAdmin,
  initialActionId
}: Props) {
  const [providerId, setProviderId] = useState(providers[0]?.id ?? "");
  const provider = providers.find((item) => item.id === providerId) ?? providers[0];
  const [selectedModel, setSelectedModel] = useState(provider?.model ?? "gpt-4.1-mini");
  const actionOptions = project.actions.filter((action) => action.approvalStatus === "PENDING" || action.approvalStatus === "DEFERRED");
  const [actionId, setActionId] = useState(actionOptions[0]?.id ?? project.actions[0]?.id ?? "");
  const action = project.actions.find((item) => item.id === actionId) ?? actionOptions[0] ?? project.actions[0];
  const [busy, setBusy] = useState(false);
  const [showActionPicker, setShowActionPicker] = useState(false);
  const [actionSearch, setActionSearch] = useState("");
  const request = teamApi ?? apiJson;
  const visibleActionOptions = actionOptions
    .filter((item) => !actionSearch || `${item.entityName} ${item.entityId} ${item.recommendedAction}`.toLowerCase().includes(actionSearch.toLowerCase()))
    .slice(0, 20);

  useEffect(() => {
    if (provider) {
      setSelectedModel(provider.model || "gpt-4.1-mini");
    }
  }, [provider]);

  useEffect(() => {
    if (initialActionId && project.actions.some((item) => item.id === initialActionId)) {
      setActionId(initialActionId);
    }
  }, [initialActionId, project.actions]);

  useEffect(() => {
    request<{ providers: Array<Record<string, any>> }>("/api/ai/providers")
      .then((res) => {
        if (res.providers && res.providers.length > 0) {
          const drafts: AiProviderDraft[] = res.providers.map((p) => ({
            id: p.id || p.provider_id || "",
            name: p.name || "",
            kind: (p.kind === "ANTHROPIC" || p.kind === "GEMINI" ? p.kind : "OPENAI_COMPATIBLE") as AiProviderDraft["kind"],
            baseUrl: p.baseUrl || p.base_url || "",
            model: Array.isArray(p.models) && p.models.length > 0 ? p.models[0] : "gpt-4.1-mini"
          }));
          onProvidersChange(drafts);
          if (!providerId) {
            setProviderId(drafts[0].id);
          }
        }
      })
      .catch(() => {});
  }, [teamApi]);

  const latestAnalysis = useMemo(
    () => analyses.find((item) => item.projectId === project.config.projectId && item.actionId === action?.id) ?? null,
    [analyses, project.config.projectId, action?.id]
  );

  function handleServerProvidersChange(serverProviders: Provider[]) {
    const drafts: AiProviderDraft[] = serverProviders.map((p) => ({
      id: p.id,
      name: p.name,
      kind: (p.kind === "ANTHROPIC" || p.kind === "GEMINI" ? p.kind : "OPENAI_COMPATIBLE") as AiProviderDraft["kind"],
      baseUrl: p.baseUrl,
      model: p.models[0] || "gpt-4.1-mini"
    }));
    onProvidersChange(drafts);
    if (drafts.length > 0 && !drafts.some((d) => d.id === providerId)) {
      setProviderId(drafts[0].id);
    }
  }

  function togglePlaybook(id: string) {
    onPlaybooksChange(selectedPlaybookIds.includes(id)
      ? selectedPlaybookIds.filter((item) => item !== id)
      : [...selectedPlaybookIds, id]);
  }

  async function analyze() {
    if (!provider) return notify("Chưa có AI provider. Hãy cấu hình provider trong AI providers dialog.", "error");
    if (!action) return notify("Hãy chạy engine để có action trước.", "error");
    setBusy(true);
    try {
      const snapshot = buildSnapshot(project, action);
      const response = await request<{ insight: AiInsight }>("/api/ai/direct", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId: provider.id,
          model: selectedModel || provider.model || "gpt-4.1-mini",
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
        model: selectedModel || provider.model || "gpt-4.1-mini",
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
            <span className="sectionKicker">ENCRYPTED KEY · MULTI-PROVIDER</span>
            <h2>AI diagnostics</h2>
            <p>AI giải thích supporting metrics và giả thuyết; rule engine vẫn là nguồn action duy nhất.</p>
          </div>
          <div className="headerActions">
            <span className="statusBadge success"><ShieldCheck size={14} /> Key mã hóa phía server</span>
            {isAdmin && <ProviderDialog teamApi={teamApi} onProvidersChange={handleServerProvidersChange} />}
          </div>
        </div>
        <div className="formGrid">
          <label>Provider
            <select value={providerId} onChange={(event) => setProviderId(event.target.value)}>
              {providers.length === 0 && <option value="">Chưa có provider · hãy thêm provider</option>}
              {providers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label>Loại API
            <input value={provider?.kind ?? ""} readOnly disabled />
          </label>
          <label>Base URL
            <input value={provider?.baseUrl ?? ""} readOnly disabled />
          </label>
          <label>Model
            <input value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)} placeholder="gpt-4.1-mini" />
          </label>
          <div className="fullWidth actionContextPicker">
            <span>Action đang phân tích</span>
            {action ? (
              <button className="selectedActionCard" type="button" onClick={() => setShowActionPicker((value) => !value)} aria-expanded={showActionPicker}>
                <span><strong>{action.entityName}</strong><small>{action.entityLevel} · {action.recommendedAction} · {action.approvalStatus}</small></span>
                <ChevronDown size={17} />
              </button>
            ) : <div className="emptyInline">Chưa có action · hãy chạy engine trước.</div>}
            {showActionPicker && (
              <div className="actionPickerPanel">
                <label className="compactSearch"><Search size={15} /><input value={actionSearch} onChange={(event) => setActionSearch(event.target.value)} placeholder="Tìm tên hoặc ID entity…" autoFocus /></label>
                <div className="actionPickerResults">
                  {visibleActionOptions.map((item) => (
                    <button key={item.id} type="button" className={item.id === action?.id ? "active" : ""} onClick={() => { setActionId(item.id); setShowActionPicker(false); }}>
                      <strong>{item.entityName}</strong><small>{item.entityLevel} · {item.recommendedAction}</small>
                    </button>
                  ))}
                  {!visibleActionOptions.length && <small>Không tìm thấy action đang mở.</small>}
                </div>
              </div>
            )}
          </div>
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
          <span className="helperText">API key được lưu mã hóa phía server và giải mã an toàn khi thực thi request.</span>
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
