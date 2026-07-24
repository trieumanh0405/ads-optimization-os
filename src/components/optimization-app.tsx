"use client";

import { useState } from "react";
import { Braces, Database, Gauge, Github, ListChecks, Play, ShieldCheck, Sparkles } from "lucide-react";

type EngineOutput = {
  status?: string;
  qc?: { status: string; issues: Array<{ code: string; severity: string; message: string }> };
  recommendations?: Array<{
    entityLevel: string; entityId: string; entityName: string; recommendedAction: string;
    adjustmentPct: number | null; currentMetric: number | null; targetMetric: number;
    confidence: number; reasonCodes: string[];
  }>;
  actions?: unknown[];
  error?: string;
  details?: unknown;
};

const emptyRequest = `{
  "asOfDate": "YYYY-MM-DD",
  "runAt": "YYYY-MM-DDTHH:mm:ss+07:00",
  "config": {},
  "metricDefinitions": [],
  "rules": [],
  "facts": [],
  "priorActions": []
}`;

export function OptimizationApp() {
  const [input, setInput] = useState(emptyRequest);
  const [output, setOutput] = useState<EngineOutput | null>(null);
  const [running, setRunning] = useState(false);

  async function runEngine() {
    setRunning(true);
    try {
      const response = await fetch("/api/optimize", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: input
      });
      setOutput(await response.json());
    } catch (error) {
      setOutput({ error: error instanceof Error ? error.message : "REQUEST_FAILED" });
    } finally {
      setRunning(false);
    }
  }

  return <main className="engineShell">
    <aside className="engineSidebar">
      <div className="brand"><span className="brandMark">O</span><div><b>OPTIMIZE</b><small>CORE ENGINE</small></div></div>
      <nav>
        <a className="active"><Braces size={18}/> Engine console</a>
        <a href="#contracts"><Database size={18}/> Data contracts</a>
        <a href="#formula"><Gauge size={18}/> Formula specification</a>
        <a href="#workflow"><ListChecks size={18}/> Action workflow</a>
        <a href="#ai"><Sparkles size={18}/> AI boundary</a>
      </nav>
      <a className="repoLink" href="https://github.com/trieumanh0405/ads-optimization-os" target="_blank" rel="noreferrer"><Github size={17}/> Private repository</a>
    </aside>
    <section className="engineMain">
      <header className="engineHeader">
        <div><p className="eyebrow">NO SAMPLE DATA · PRODUCTION CONTRACT</p><h1>Ads Optimization Core Engine</h1><p>Paste normalized project input and execute the same deterministic engine used by stored project runs.</p></div>
        <span className="engineStatus"><i/> API ready</span>
      </header>

      <section className="consoleGrid">
        <article className="consolePanel">
          <header><div><Braces size={17}/><b>Engine request</b></div><span>POST /api/optimize</span></header>
          <textarea aria-label="Engine request JSON" spellCheck={false} value={input} onChange={(event) => setInput(event.target.value)}/>
          <footer><span>Validated by the complete Zod contract before execution.</span><button className="primaryButton" onClick={runEngine} disabled={running}><Play size={16}/>{running ? "Running…" : "Run engine"}</button></footer>
        </article>
        <article className="consolePanel outputPanel">
          <header><div><ShieldCheck size={17}/><b>Engine output</b></div><span>{output?.status ?? "Waiting for input"}</span></header>
          {!output ? <div className="emptyOutput"><ShieldCheck size={34}/><h3>No fabricated result</h3><p>Output appears only after valid input is submitted.</p></div>
            : <pre>{JSON.stringify(output, null, 2)}</pre>}
        </article>
      </section>

      {output?.recommendations?.length ? <section className="resultPanel">
        <header><h2>Recommendations</h2><span>QC: {output.qc?.status}</span></header>
        <div className="tableWrap"><table><thead><tr><th>Level</th><th>Entity</th><th>Metric</th><th>Target</th><th>Action</th><th>Adjustment</th><th>Confidence</th><th>Evidence</th></tr></thead>
          <tbody>{output.recommendations.map((item) => <tr key={`${item.entityLevel}-${item.entityId}`}><td>{item.entityLevel}</td><td><strong>{item.entityName}</strong><small>{item.entityId}</small></td><td>{item.currentMetric ?? "—"}</td><td>{item.targetMetric}</td><td><span className="action keep">{item.recommendedAction}</span></td><td>{item.adjustmentPct ?? "—"}</td><td>{Math.round(item.confidence * 100)}%</td><td>{item.reasonCodes.join(", ")}</td></tr>)}</tbody>
        </table></div>
      </section> : null}

      <section className="capabilityGrid">
        <article id="contracts"><Database/><h3>Canonical data & mapping</h3><p>Brand columns map to a strict fact contract. Missing metrics stay null; duplicate keys, stale data and invalid hierarchy block the run.</p><code>/api/normalize</code></article>
        <article id="formula"><Gauge/><h3>Windows & two-layer scoring</h3><p>Today, prior short/long and lifetime achievements combine by configurable weights, then blend with parent/project context.</p><code>src/core/windows.ts</code></article>
        <article id="workflow"><ListChecks/><h3>Rules & action lifecycle</h3><p>Priority conflict, CBO/ABO ownership, scale caps, deduplication and append-only approval events are enforced centrally.</p><code>src/core/rules.ts</code></article>
        <article id="ai"><Sparkles/><h3>AI is advisory</h3><p>Authenticated providers use encrypted keys and versioned playbooks. AI cannot override or execute deterministic actions.</p><code>/api/ai/analyze</code></article>
      </section>
    </section>
  </main>;
}
