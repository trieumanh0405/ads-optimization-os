"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, Bell, ChevronDown, CircleDollarSign, Database, Download, Filter, Gauge, LayoutDashboard, ListChecks, Play, Search, Settings2, ShieldCheck, Sparkles, Upload } from "lucide-react";
import { ProviderDialog } from "./provider-dialog";
import { defaultRuleConfig, optimizeEntity, parseEntityCsv, type AppDecision, type AppRuleConfig, type EntityMetric } from "@/domain/optimization";

type View = "board" | "queue" | "data" | "rules" | "ai" | "audit";
const seed: EntityMetric[] = [
  { id: "c1", level: "campaign", name: "BVIS | Lead Gen | HCM", spend: 18400000, results: 65, metric: 283077 },
  { id: "as1", level: "adset", name: "Parents 30–45 · Broad", spend: 7200000, results: 17, metric: 423529 },
  { id: "a1", level: "ad", name: "Video 03 · Campus tour", spend: 3800000, results: 19, metric: 200000 },
  { id: "a2", level: "ad", name: "Static 07 · Scholarship", spend: 2900000, results: 4, metric: 725000 },
  { id: "as2", level: "adset", name: "Lookalike QLead 3%", spend: 1100000, results: 0, metric: null }
];
const money = (n: number | null) => n === null ? "—" : new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 }).format(n);
const label = (r: AppDecision) => r.action === "INCREASE_BUDGET" ? `INCREASE ${r.adjustmentPct}%` : r.action === "DECREASE_BUDGET" ? `DECREASE ${r.adjustmentPct}%` : r.action.replaceAll("_", " ");
const color = (a: AppDecision["action"]) => ({ INCREASE_BUDGET: "increase", DECREASE_BUDGET: "decrease", KEEP: "keep", TURN_OFF: "off", PENDING_DATA: "pending", REVIEW_MANUALLY: "pending" }[a]);

export function OptimizationApp() {
  const [view, setView] = useState<View>("board");
  const [entities, setEntities] = useState(seed);
  const [config, setConfig] = useState(defaultRuleConfig);
  const [decisions, setDecisions] = useState(() => seed.map((x) => optimizeEntity(x, defaultRuleConfig)));
  const [query, setQuery] = useState(""); const [level, setLevel] = useState("all"); const [notice, setNotice] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { const value = localStorage.getItem("ads-opt-state"); if (value) try { const x = JSON.parse(value); setEntities(x.entities); setConfig(x.config); setDecisions(x.decisions); } catch {} }, []);
  useEffect(() => localStorage.setItem("ads-opt-state", JSON.stringify({ entities, config, decisions })), [entities, config, decisions]);
  const rows = useMemo(() => decisions.filter((r) => (level === "all" || r.level === level) && r.name.toLowerCase().includes(query.toLowerCase())), [decisions, level, query]);
  const spend = entities.reduce((s, x) => s + x.spend, 0); const pending = decisions.filter((x) => x.status === "PENDING").length;
  const run = () => { setDecisions(entities.map((x) => optimizeEntity(x, config))); setNotice(`Đã chạy rule cho ${entities.length} entities.`); };
  const review = (id: string, status: AppDecision["status"]) => { setDecisions((all) => all.map((x) => x.id === id ? { ...x, status } : x)); setNotice(`Action đã chuyển sang ${status}.`); };
  const importCsv = async (file?: File) => { if (!file) return; try { const data = parseEntityCsv(await file.text()); setEntities(data); setDecisions(data.map((x) => optimizeEntity(x, config))); setView("board"); setNotice(`Đã import ${data.length} entities.`); } catch (e) { setNotice(e instanceof Error ? e.message : "CSV không hợp lệ"); } };
  const template = () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["entity_id,entity_level,entity_name,spend,results,metric_value,impressions,clicks\ncampaign_1,campaign,Campaign demo,1000000,4,250000,50000,1200"], { type: "text/csv" })); a.download = "ads-opt-template.csv"; a.click(); URL.revokeObjectURL(a.href); };
  const nav = (id: View, text: string, Icon: typeof LayoutDashboard, badge?: number) => <button className={view === id ? "active" : ""} onClick={() => setView(id)}><Icon size={18}/>{text}{badge !== undefined && <span>{badge}</span>}</button>;

  return <main className="shell">
    <aside className="sidebar"><div className="brand"><span className="brandMark">O</span><div><b>OPTIMIZE</b><small>ADS OPERATIONS</small></div></div>
      <nav>{nav("board", "Decision board", LayoutDashboard)}{nav("queue", "Action queue", ListChecks, pending)}{nav("data", "Data sources", Database)}{nav("rules", "KPI & rules", Gauge)}{nav("ai", "AI settings", Sparkles)}</nav>
      <div className="sideBottom">{nav("audit", "Audit & status", ShieldCheck)}<button onClick={() => setView("rules")}><Settings2 size={18}/>Settings</button><div className="user"><span>VD</span><div><b>Viet Dung</b><small>Administrator</small></div></div></div>
    </aside>
    <section className="content"><header className="topbar"><button className="projectPicker"><span className="projectAvatar">BV</span><span><small>PROJECT</small><b>BVIS Vietnam</b></span><ChevronDown size={16}/></button><div className="topActions"><div className="sync"><i/> Functional local MVP</div><ProviderDialog/><button className="iconButton" aria-label="Thông báo" onClick={() => setNotice("Không có cảnh báo mới.")}><Bell size={18}/></button></div></header>
      {notice && <button className="toast" onClick={() => setNotice("")}>{notice}<span>×</span></button>}
      <div className="page">
        {view === "board" && <><Title eyebrow="LIVE RULE ENGINE" title="Optimization command center" text="Import data, run rules and review concrete actions." action={<button className="primaryButton" onClick={run}><Play size={16}/> Run optimization</button>}/>
          <section className="stats"><Stat icon={<CircleDollarSign/>} tone="blue" name="Total spend" value={money(spend)} note={`${entities.length} entities`}/><Stat icon={<Gauge/>} tone="cyan" name="Target KPI" value={money(config.target)} note="CPA / CPQL"/><Stat icon={<ListChecks/>} tone="amber" name="Pending actions" value={`${pending}`} note="Awaiting review"/><Stat icon={<Activity/>} tone="red" name="Data rows" value={`${entities.length}`} note="Ready to evaluate"/></section>
          <Table rows={rows} query={query} setQuery={setQuery} level={level} setLevel={setLevel} review={review}/></>}
        {view === "queue" && <><Title eyebrow="WORKFLOW" title="Action queue" text="Mark the result after execution in Ads Manager."/><Table rows={rows} query={query} setQuery={setQuery} level={level} setLevel={setLevel} review={review} workflow/></>}
        {view === "data" && <><Title eyebrow="DATA INGESTION" title="Import normalized ads data" text="This MVP processes CSV immediately in your browser."/><section className="toolCard"><div className="uploadZone" onClick={() => fileRef.current?.click()}><Upload size={28}/><h3>Select CSV</h3><p>Import replaces the current dataset and reruns rules.</p><button className="primaryButton">Browse CSV</button><input hidden ref={fileRef} type="file" accept=".csv" onChange={(e) => importCsv(e.target.files?.[0])}/></div><div className="schemaHelp"><h3>Required contract</h3><code>entity_id, entity_level, entity_name, spend, results</code><p>Optional: metric_value, impressions, clicks. Metric defaults to spend/results.</p><button className="secondaryButton" onClick={template}><Download size={16}/> Download template</button></div></section></>}
        {view === "rules" && <Rules config={config} setConfig={setConfig} run={run}/>}
        {view === "ai" && <><Title eyebrow="AI DIAGNOSTICS" title="AI providers & playbooks" text="AI can explain supporting signals but cannot override actions."/><section className="toolCard"><div><h3>Multi-provider adapter</h3><p>OpenAI-compatible endpoints and per-project model selection are prepared.</p><ProviderDialog/></div><div className="schemaHelp"><h3>Safe by default</h3><p>Real API calls stay disabled until server-side secrets and authentication are connected.</p><span className="action pending">SERVER KEY REQUIRED</span></div></section></>}
        {view === "audit" && <><Title eyebrow="SYSTEM STATUS" title="MVP readiness" text="What works now versus the upcoming shared backend."/><section className="guardrailCard wide"><header><ShieldCheck/><h3>Functional checks</h3></header><ul>{["CSV import|ACTIVE","Rule evaluation|ACTIVE","Action approval states|ACTIVE","Browser persistence|ACTIVE","Firebase multi-user backend|NOT CONNECTED","Meta/n8n ingestion|NOT CONNECTED"].map((x) => { const [a,b]=x.split("|"); return <li key={a}><span>{a}</span><b>{b}</b></li>})}</ul></section></>}
      </div>
    </section>
  </main>;
}

function Title({ eyebrow, title, text, action }: { eyebrow: string; title: string; text: string; action?: React.ReactNode }) { return <div className="titleRow"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{text}</p></div>{action}</div> }
function Stat({ icon, tone, name, value, note }: { icon: React.ReactNode; tone: string; name: string; value: string; note: string }) { return <article><span className={`statIcon ${tone}`}>{icon}</span><div><small>{name}</small><strong>{value}</strong><em>{note}</em></div></article> }

function Table({ rows, query, setQuery, level, setLevel, review, workflow=false }: { rows: AppDecision[]; query:string; setQuery:(x:string)=>void; level:string; setLevel:(x:string)=>void; review:(id:string,s:AppDecision["status"])=>void; workflow?:boolean }) {
  return <section className="decisionPanel"><header className="panelHeader"><div><h2>{workflow ? "Review actions" : "Recommended actions"}</h2><p>Explainable output from current rules</p></div><div className="filters"><label className="searchBox"><Search size={15}/><input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Search"/></label><label className="selectBox"><Filter size={15}/><select value={level} onChange={(e)=>setLevel(e.target.value)}><option value="all">All levels</option><option value="campaign">Campaign</option><option value="adset">Ad set</option><option value="ad">Ad</option></select></label></div></header>
    <div className="tableWrap"><table><thead><tr><th>Entity</th><th>Spend</th><th>Metric</th><th>Recommendation</th><th>Confidence</th><th>Evidence</th><th>{workflow?"Review":"Status"}</th></tr></thead><tbody>{rows.map((r)=><tr key={r.id}><td><small className="level">{r.level}</small><strong>{r.name}</strong></td><td className="mono">{money(r.spend)}</td><td className="mono">{money(r.metric)}</td><td><span className={`action ${color(r.action)}`}>{label(r)}</span></td><td><span className={`confidence ${r.confidence.toLowerCase()}`}><i/>{r.confidence}</span></td><td className="evidence">{r.reason}</td><td>{workflow && r.status==="PENDING"?<div className="reviewButtons"><button onClick={()=>review(r.id,"DONE")}>Done</button><button onClick={()=>review(r.id,"REJECTED")}>Reject</button><button onClick={()=>review(r.id,"DEFERRED")}>Defer</button></div>:<span className={`workflowStatus ${r.status.toLowerCase()}`}>{r.status}</span>}</td></tr>)}</tbody></table></div><footer className="panelFooter"><span>{rows.length} entities</span><span>No automatic Meta execution</span></footer></section>
}

function Rules({ config, setConfig, run }: { config:AppRuleConfig; setConfig:(x:AppRuleConfig)=>void; run:()=>void }) {
  const field=(key:keyof AppRuleConfig,name:string,suffix:string)=><label>{name}<div className="numberInput"><input type="number" value={config[key]} onChange={(e)=>setConfig({...config,[key]:Number(e.target.value)})}/><span>{suffix}</span></div></label>;
  return <><Title eyebrow="PROJECT CONFIG" title="KPI & optimization rules" text="Change thresholds and rerun without editing formulas."/><section className="ruleForm"><div className="formSection"><h3>Primary KPI</h3>{field("target","Target CPA / CPQL","VND")}{field("minSpendMultiplier","Minimum spend","× target")}</div><div className="formSection"><h3>Thresholds</h3>{field("increaseBelowPct","Increase when ≤","% target")}{field("decreaseAbovePct","Decrease when ≥","% target")}{field("turnOffAbovePct","Turn off when ≥","% target")}</div><div className="formSection"><h3>Guardrails</h3>{field("increasePct","Increase budget by","%")}{field("decreasePct","Decrease budget by","%")}<p className="muted">Ads never receive budget actions.</p></div><footer><button className="primaryButton" onClick={run}><Play size={16}/> Save & run</button></footer></section></>
}
