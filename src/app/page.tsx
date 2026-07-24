import { Activity, Bell, ChevronDown, CircleDollarSign, Database, Filter, Gauge, LayoutDashboard, ListChecks, Search, Settings2, ShieldCheck, Sparkles, TrendingDown, TrendingUp } from "lucide-react";
import { ProviderDialog } from "@/components/provider-dialog";

const rows = [
  { level: "Campaign", name: "BVIS | Lead Gen | HCM", spend: "₫18.4M", metric: "₫284K", target: "₫320K", action: "INCREASE 15%", tone: "increase", confidence: "High", why: "CPA đạt 112% KPI · 7D ổn định" },
  { level: "Ad set", name: "Parents 30–45 · Broad", spend: "₫7.2M", metric: "₫421K", target: "₫320K", action: "DECREASE 10%", tone: "decrease", confidence: "Medium", why: "CPA vượt target 32% · Frequency tăng" },
  { level: "Ad", name: "Video 03 · Campus tour", spend: "₫3.8M", metric: "₫198K", target: "₫320K", action: "KEEP", tone: "keep", confidence: "High", why: "CTR 2.8% · CVR tốt nhất ad set" },
  { level: "Ad", name: "Static 07 · Scholarship", spend: "₫2.9M", metric: "₫615K", target: "₫320K", action: "TURN OFF", tone: "off", confidence: "High", why: "Đủ min spend · CPA vượt 92%" },
  { level: "Ad set", name: "Lookalike QLead 3%", spend: "₫1.1M", metric: "—", target: "₫320K", action: "PENDING DATA", tone: "pending", confidence: "Low", why: "Chưa đạt minimum result" }
];

export default function Home() {
  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand"><span className="brandMark">O</span><div><b>OPTIMIZE</b><small>ADS OPERATIONS</small></div></div>
        <nav>
          <a className="active"><LayoutDashboard size={18}/> Decision board</a>
          <a><ListChecks size={18}/> Action queue <span>12</span></a>
          <a><Activity size={18}/> Performance</a>
          <a><Database size={18}/> Data sources</a>
          <a><Gauge size={18}/> KPI & rules</a>
          <a><Sparkles size={18}/> AI insights</a>
        </nav>
        <div className="sideBottom">
          <a><ShieldCheck size={18}/> Audit log</a>
          <a><Settings2 size={18}/> Settings</a>
          <div className="user"><span>VD</span><div><b>Viet Dung</b><small>Administrator</small></div></div>
        </div>
      </aside>

      <section className="content">
        <header className="topbar">
          <button className="projectPicker"><span className="projectAvatar">BV</span><span><small>PROJECT</small><b>BVIS Vietnam</b></span><ChevronDown size={16}/></button>
          <div className="topActions"><div className="sync"><i/> Data synced 8 min ago</div><ProviderDialog/><button className="iconButton" aria-label="Thông báo"><Bell size={18}/></button></div>
        </header>

        <div className="page">
          <div className="titleRow">
            <div><p className="eyebrow">DECISION SUPPORT · 25 JUL 2026</p><h1>Optimization command center</h1><p>Rule-based actions first. AI diagnostics explain the supporting signals.</p></div>
            <button className="primaryButton"><Sparkles size={16}/> Run optimization</button>
          </div>

          <section className="stats">
            <article><span className="statIcon blue"><CircleDollarSign size={19}/></span><div><small>Spend today</small><strong>₫42.8M</strong><em className="good"><TrendingDown size={14}/> 4.2% vs plan</em></div></article>
            <article><span className="statIcon cyan"><Gauge size={19}/></span><div><small>Primary KPI · CPQL</small><strong>₫318K</strong><em className="good"><TrendingUp size={14}/> 106% achievement</em></div></article>
            <article><span className="statIcon amber"><ListChecks size={19}/></span><div><small>Pending actions</small><strong>12</strong><em>4 need review</em></div></article>
            <article><span className="statIcon red"><Activity size={19}/></span><div><small>Data quality</small><strong>98.6%</strong><em className="good">All sources healthy</em></div></article>
          </section>

          <section className="decisionPanel">
            <header className="panelHeader">
              <div><h2>Recommended actions</h2><p>Today + 3D + 7D evidence · Rule set <b>Lead Gen v2.4</b></p></div>
              <div className="filters"><button><Search size={15}/> Search</button><button><Filter size={15}/> All levels</button><button>Pending review <span>12</span></button></div>
            </header>
            <div className="tableWrap">
              <table>
                <thead><tr><th>Entity</th><th>Spend · 7D</th><th>CPQL</th><th>Target</th><th>Recommendation</th><th>Confidence</th><th>Evidence</th><th/></tr></thead>
                <tbody>{rows.map((row) => <tr key={row.name}>
                  <td><small className="level">{row.level}</small><strong>{row.name}</strong></td>
                  <td className="mono">{row.spend}</td><td className="mono">{row.metric}</td><td className="mono muted">{row.target}</td>
                  <td><span className={`action ${row.tone}`}>{row.action}</span></td>
                  <td><span className={`confidence ${row.confidence.toLowerCase()}`}><i/>{row.confidence}</span></td>
                  <td className="evidence">{row.why}</td><td><button className="more">•••</button></td>
                </tr>)}</tbody>
              </table>
            </div>
            <footer className="panelFooter"><span>Showing 5 of 84 active entities</span><button>Open full action queue →</button></footer>
          </section>

          <section className="lowerGrid">
            <article className="insightCard">
              <header><div><Sparkles size={17}/><h3>AI diagnostic</h3></div><span>Model: configurable</span></header>
              <div className="insightBody"><span className="signal warning">WATCH</span><div><strong>Creative fatigue may be developing in “Parents 30–45”.</strong><p>Frequency rose 21% while outbound CTR fell from 2.1% to 1.5%. The rule engine recommends decreasing budget based on CPQL; AI suggests checking creative rotation before the next scale decision.</p><button>View metric evidence →</button></div></div>
              <footer>AI analysis is advisory and cannot override or execute rule actions.</footer>
            </article>
            <article className="guardrailCard"><header><ShieldCheck size={18}/><h3>Active guardrails</h3></header><ul><li><span>Minimum spend before stop</span><b>1.25 × target</b></li><li><span>Maximum daily scale</span><b>20%</b></li><li><span>Data freshness</span><b>&lt; 3 hours</b></li><li><span>Conflicting rule handling</span><b>Manual review</b></li></ul></article>
          </section>
        </div>
      </section>
    </main>
  );
}
