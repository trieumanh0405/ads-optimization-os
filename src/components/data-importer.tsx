"use client";

import { useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Link2, Plus, RefreshCw, Trash2, UploadCloud } from "lucide-react";
import { parseCsv } from "@/core/csv";
import type { FactRow } from "@/core/schemas";
import { normalizeRows, type NormalizeError, type SourceMapping } from "@/core/normalize";
import { requiredMappingGaps, suggestMappings } from "@/product/mapping";
import type { LocalProject } from "@/product/types";
import type { TeamApi } from "@/product/team-api";

const IMPORT_BATCH_SIZE = 350;

function inBatches<T>(items: T[], size: number) {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) batches.push(items.slice(index, index + size));
  return batches;
}

type GoogleSheetPreview = {
  spreadsheetId: string;
  spreadsheetTitle: string;
  sheetName: string;
  headerRow: number;
  headers: string[];
  rows: Record<string, string>[];
  truncated: boolean;
};

type Props = {
  project: LocalProject;
  onUpdate: (project: LocalProject) => void;
  notify: (message: string, tone?: "success" | "error") => void;
  teamApi?: TeamApi;
};

const fieldLabels: Record<string, string> = {
  date: "Ngày báo cáo",
  entityLevel: "Cấp entity",
  campaignId: "Campaign ID / tên fallback",
  adsetId: "Ad set ID / tên fallback",
  adId: "Ad ID / tên fallback",
  entityName: "Tên entity",
  status: "Trạng thái",
  budgetType: "CBO / ABO",
  budget: "Ngân sách",
  spend: "Spend",
  result: "Result",
  qualifiedResult: "Qualified result",
  revenue: "Revenue",
  impressions: "Impressions",
  clicks: "Link clicks / Clicks",
  sourceUpdatedAt: "Thời điểm data cập nhật"
};

export function DataImporter({ project, onUpdate, notify, teamApi }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [sourceKind, setSourceKind] = useState<"CSV" | "GOOGLE_SHEETS">(project.config.dataSource.kind);
  const [spreadsheetInput, setSpreadsheetInput] = useState(project.config.dataSource.spreadsheetId ?? "");
  const [sheetName, setSheetName] = useState(project.config.dataSource.sheetName ?? "");
  const [headerRow, setHeaderRow] = useState(project.config.dataSource.headerRow ?? 1);
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(project.config.dataSource.autoSyncEnabled);
  const [syncIntervalMinutes, setSyncIntervalMinutes] = useState(project.config.dataSource.syncIntervalMinutes);
  const [autoRunAfterSync, setAutoRunAfterSync] = useState(project.config.dataSource.autoRunAfterSync);
  const [googleSource, setGoogleSource] = useState<GoogleSheetPreview | null>(null);
  const [sourceBusy, setSourceBusy] = useState(false);
  const [entityLevel, setEntityLevel] = useState<FactRow["entityLevel"]>("AD");
  const [budgetType, setBudgetType] = useState<FactRow["budgetType"]>("UNKNOWN");
  const [mode, setMode] = useState<"STRICT" | "PARTIAL">("STRICT");
  const [mappings, setMappings] = useState<SourceMapping[]>([]);
  const [metricMappings, setMetricMappings] = useState(project.metricMappings);
  const [dimensionMappings, setDimensionMappings] = useState(project.dimensionMappings);
  const [errors, setErrors] = useState<NormalizeError[]>([]);
  const [busy, setBusy] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ completed: number; total: number } | null>(null);

  const headers = useMemo(() => rows[0] ? Object.keys(rows[0]) : [], [rows]);
  const gaps = useMemo(() => requiredMappingGaps(mappings), [mappings]);
  const errorSummary = useMemo(() => {
    const counts = new Map<string, number>();
    for (const error of errors) counts.set(error.code, (counts.get(error.code) ?? 0) + 1);
    return [...counts.entries()];
  }, [errors]);

  function resetSuggestions(nextRows: Record<string, string>[], nextLevel = entityLevel, nextBudget = budgetType) {
    const nextHeaders = nextRows[0] ? Object.keys(nextRows[0]) : [];
    const suggested = suggestMappings(nextHeaders, nextLevel, nextBudget, new Date().toISOString());
    setMappings(suggested.mappings);
    setMetricMappings(suggested.metricMappings);
    setDimensionMappings(suggested.dimensionMappings);
  }

  async function handleFile(file: File) {
    try {
      const parsed = parseCsv(await file.text());
      setSourceKind("CSV");
      setGoogleSource(null);
      setFileName(file.name);
      setRows(parsed);
      setErrors([]);
      resetSuggestions(parsed);
      notify(`Đã đọc ${parsed.length.toLocaleString("vi-VN")} dòng từ ${file.name}.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không đọc được file CSV.", "error");
    }
  }

  function chooseSource(next: "CSV" | "GOOGLE_SHEETS") {
    setSourceKind(next);
    setRows([]);
    setFileName("");
    setErrors([]);
    setMappings([]);
  }

  async function loadGoogleSheet() {
    if (!teamApi) return notify("Google Sheets chỉ hoạt động khi dùng team workspace đã kết nối Supabase.", "error");
    if (!spreadsheetInput.trim()) return notify("Dán URL hoặc Spreadsheet ID của Google Sheet trước.", "error");
    setSourceBusy(true);
    try {
      const preview = await teamApi<GoogleSheetPreview>(`/api/projects/${encodeURIComponent(project.config.projectId)}/sources/google-sheets/preview`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spreadsheetInput, sheetName: sheetName.trim() || undefined, headerRow })
      });
      setGoogleSource(preview);
      setSpreadsheetInput(preview.spreadsheetId);
      setSheetName(preview.sheetName);
      setHeaderRow(preview.headerRow);
      setFileName(`Google Sheets · ${preview.spreadsheetTitle} / ${preview.sheetName}`);
      setRows(preview.rows);
      setErrors([]);
      resetSuggestions(preview.rows);
      notify(`Đã đọc ${preview.rows.length.toLocaleString("vi-VN")} dòng và quét ${preview.headers.length} cột từ Google Sheets.${preview.truncated ? " Dữ liệu vượt giới hạn 20.000 dòng; hãy lọc nguồn trước." : ""}`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "GOOGLE_SHEETS_PREVIEW_FAILED", "error");
    } finally {
      setSourceBusy(false);
    }
  }

  function changeLevel(next: FactRow["entityLevel"]) {
    setEntityLevel(next);
    resetSuggestions(rows, next, budgetType);
  }

  function changeBudget(next: FactRow["budgetType"]) {
    setBudgetType(next);
    resetSuggestions(rows, entityLevel, next);
  }

  function updateMapping(index: number, sourceColumn: string) {
    setMappings((current) => current.map((item, itemIndex) =>
      itemIndex === index ? { ...item, sourceColumn } : item
    ));
  }

  async function validateAndImport() {
    if (!rows.length) return notify(sourceKind === "GOOGLE_SHEETS" ? "Hãy kết nối và quét Google Sheet trước." : "Hãy chọn file CSV trước.", "error");
    if (gaps.length) return notify(`Thiếu mapping bắt buộc: ${gaps.join(", ")}.`, "error");
    const metricKeys = metricMappings.map((item) => item.metricKey.trim());
    const dimensionKeys = dimensionMappings.map((item) => item.dimensionKey.trim());
    if (metricKeys.some((key) => !key) || new Set(metricKeys).size !== metricKeys.length) {
      return notify("Supporting metric key không được trống hoặc trùng nhau.", "error");
    }
    if (dimensionKeys.some((key) => !key) || new Set(dimensionKeys).size !== dimensionKeys.length) {
      return notify("Dimension key không được trống hoặc trùng nhau.", "error");
    }
    setBusy(true);
    try {
      const result = normalizeRows(rows, {
        projectId: project.config.projectId,
        platform: project.config.platform,
        accountId: project.config.accountId,
        mappings,
        metricMappings,
        dimensionMappings
      });
      setErrors(result.errors);
      if (mode === "STRICT" && result.errors.length) {
        notify(`Strict mode đã chặn import vì có ${result.errors.length} lỗi.`, "error");
        return;
      }
      const acceptedFacts = mode === "PARTIAL" ? result.facts : result.errors.length ? [] : result.facts;
      const nextConfig = {
        ...project.config,
        dataSource: sourceKind === "GOOGLE_SHEETS" && googleSource ? {
          kind: "GOOGLE_SHEETS" as const,
          spreadsheetId: googleSource.spreadsheetId,
          sheetName: googleSource.sheetName,
          headerRow: googleSource.headerRow,
          autoSyncEnabled,
          syncIntervalMinutes,
          autoRunAfterSync,
          lastSyncedAt: new Date().toISOString(),
          lastSyncStatus: result.errors.length ? "PARTIAL" as const : "SUCCESS" as const
        } : {
          kind: "CSV" as const,
          autoSyncEnabled: false,
          syncIntervalMinutes,
          autoRunAfterSync: false
        }
      };
      if (teamApi) {
        await teamApi("/api/projects", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            config: nextConfig, metricDefinitions: project.metricDefinitions, rules: project.rules,
            mappings, metricMappings, dimensionMappings
          })
        });
      }
      let storedImport: { importRecord: LocalProject["imports"][number] } | null = null;
      if (teamApi) {
        const batches = inBatches(acceptedFacts, IMPORT_BATCH_SIZE);
        setBatchProgress({ completed: 0, total: batches.length });
        for (let index = 0; index < batches.length; index += 1) {
          await teamApi(`/api/projects/${encodeURIComponent(project.config.projectId)}/import`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ facts: batches[index] })
          });
          setBatchProgress({ completed: index + 1, total: batches.length });
        }
        storedImport = await teamApi<{ importRecord: LocalProject["imports"][number] }>(`/api/projects/${encodeURIComponent(project.config.projectId)}/import`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ finalize: {
            fileName, entityLevel, accepted: acceptedFacts.length, rejected: new Set(result.errors.map((item) => item.row)).size,
            mode, errorCodes: [...new Set(result.errors.map((item) => item.code))]
          } })
        });
      }
      const factsByKey = new Map(project.facts.map((fact) => [fact.sourceRowKey, fact]));
      for (const fact of acceptedFacts) factsByKey.set(fact.sourceRowKey, fact);
      const now = new Date().toISOString();
      onUpdate({
        ...project,
        config: nextConfig,
        facts: [...factsByKey.values()],
        mappings,
        metricMappings,
        dimensionMappings,
        imports: [storedImport?.importRecord ?? {
          id: crypto.randomUUID(),
          importedAt: now,
          fileName,
          entityLevel,
          accepted: acceptedFacts.length,
          rejected: new Set(result.errors.map((item) => item.row)).size,
          mode,
          errorCodes: [...new Set(result.errors.map((item) => item.code))]
        }, ...project.imports].slice(0, 100),
        updatedAt: now
      });
      notify(`Đã import ${acceptedFacts.length.toLocaleString("vi-VN")} dòng chuẩn hóa.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Import thất bại.", "error");
    } finally {
      setBusy(false);
      setBatchProgress(null);
    }
  }

  return (
    <div className="viewStack">
      <section className="sectionCard">
        <div className="sectionHeader">
          <div>
            <span className="sectionKicker">RAW DATA → FACT DAILY</span>
            <h2>Import và ánh xạ dữ liệu</h2>
            <p>CSV thật được chuẩn hóa trước khi đưa vào engine. Dòng lỗi không bao giờ âm thầm thành số 0.</p>
          </div>
          <div className="importControls">
            <div className="segmented" aria-label="Nguồn dữ liệu">
              <button className={sourceKind === "CSV" ? "active" : ""} onClick={() => chooseSource("CSV")}>CSV</button>
              <button className={sourceKind === "GOOGLE_SHEETS" ? "active" : ""} onClick={() => chooseSource("GOOGLE_SHEETS")}>Google Sheets</button>
            </div>
            <div className="segmented" aria-label="Import mode">
              <button className={mode === "STRICT" ? "active" : ""} onClick={() => setMode("STRICT")}>Strict · an toàn</button>
              <button className={mode === "PARTIAL" ? "active" : ""} onClick={() => setMode("PARTIAL")}>Partial · lọc lỗi</button>
            </div>
          </div>
        </div>

        {sourceKind === "CSV" ? <>
          <input
            ref={fileInput}
            className="visuallyHidden"
            type="file"
            accept=".csv,text/csv,text/tab-separated-values"
            onChange={(event) => event.target.files?.[0] && handleFile(event.target.files[0])}
          />
          <button className="dropZone" onClick={() => fileInput.current?.click()}>
            <UploadCloud size={28} />
            <strong>{fileName || "Chọn CSV export từ Ads Manager / connector"}</strong>
            <span>{rows.length ? `${rows.length.toLocaleString("vi-VN")} dòng · ${headers.length} cột` : "Hỗ trợ dấu phẩy, chấm phẩy và tab"}</span>
          </button>
        </> : <section className="googleSourcePanel" aria-label="Kết nối Google Sheets">
          <div className="googleSourceTitle"><Link2 size={20} /><span><strong>Google Sheets online</strong><small>Sheet phải được share Viewer cho email Service Account của tool.</small></span></div>
          <div className="formGrid compact">
            <label className="fullWidth">Google Sheets URL hoặc Spreadsheet ID
              <input value={spreadsheetInput} onChange={(event) => setSpreadsheetInput(event.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." />
            </label>
            <label>Tên tab raw (bỏ trống = tab đầu tiên)
              <input value={sheetName} onChange={(event) => setSheetName(event.target.value)} placeholder="RAW_ADS" />
            </label>
            <label>Header ở dòng
              <input type="number" min={1} max={100} value={headerRow} onChange={(event) => setHeaderRow(Math.max(1, Number(event.target.value) || 1))} />
            </label>
            <label>Tần suất auto refresh
              <select value={syncIntervalMinutes} disabled={!autoSyncEnabled} onChange={(event) => setSyncIntervalMinutes(Number(event.target.value))}>
                <option value={30}>30 phút</option>
                <option value={60}>60 phút · khuyến nghị</option>
                <option value={180}>3 giờ</option>
                <option value={360}>6 giờ</option>
              </select>
            </label>
            <label className="checkboxLine">
              <input type="checkbox" checked={autoSyncEnabled} onChange={(event) => setAutoSyncEnabled(event.target.checked)} />
              Tự refresh khi tool đang mở
            </label>
            <label className="checkboxLine fullWidth">
              <input type="checkbox" checked={autoRunAfterSync} disabled={!autoSyncEnabled} onChange={(event) => setAutoRunAfterSync(event.target.checked)} />
              Tự chạy optimization sau khi refresh thành công
            </label>
          </div>
          <div className="cardActions"><span className="helperText">Tool chỉ đọc sheet; không sửa dữ liệu nguồn.</span><button className="primaryAction" disabled={sourceBusy} onClick={() => void loadGoogleSheet()}><RefreshCw size={16} className={sourceBusy ? "spin" : ""} />{sourceBusy ? "Đang quét…" : "Kết nối & quét cột"}</button></div>
        </section>}

        <div className="formGrid compact topGap">
          <label>Cấp dữ liệu
            <select value={entityLevel} onChange={(event) => changeLevel(event.target.value as FactRow["entityLevel"])}>
              <option value="CAMPAIGN">Campaign</option>
              <option value="ADSET">Ad set</option>
              <option value="AD">Ad</option>
            </select>
          </label>
          <label>Entity sở hữu ngân sách
            <select value={budgetType} onChange={(event) => changeBudget(event.target.value as FactRow["budgetType"])}>
              <option value="UNKNOWN">Chưa xác định</option>
              <option value="CBO">CBO · Campaign sở hữu budget</option>
              <option value="ABO">ABO · Ad set sở hữu budget</option>
              <option value="NONE">Không có budget</option>
            </select>
          </label>
          <label>Project
            <input value={project.config.projectName} readOnly />
          </label>
        </div>
        <p className="importGuidance"><strong>Strict</strong> chặn cả batch nếu có một dòng lỗi — dùng khi setup nguồn lần đầu. <strong>Partial</strong> chỉ nhập dòng hợp lệ và liệt kê dòng bị bỏ — chỉ dùng sau khi bạn đã kiểm tra mapping. Nếu file ở cấp <strong>Ad</strong> có cả Campaign và Ad set, chỉ cần import một lần; tool tự tổng hợp lên hai cấp cha. CBO = Campaign sở hữu budget, ABO = Ad set sở hữu budget.</p>
      </section>

      {rows.length > 0 && (
        <section className="sectionCard">
          <div className="sectionHeader">
            <div>
              <span className="sectionKicker">COLUMN CONTRACT</span>
              <h2>Mapping cột nguồn</h2>
              <p>Hệ thống đã tự đoán. Kiểm tra kỹ ID, tên entity, Spend và Result trước khi import.</p>
            </div>
            <span className={`statusBadge ${gaps.length ? "danger" : "success"}`}>
              {gaps.length ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
              {gaps.length ? `${gaps.length} mapping còn thiếu` : "Đủ trường bắt buộc"}
            </span>
          </div>
          <div className="mappingGrid">
            {mappings.map((item, index) => (
              <label key={item.canonicalField} className={item.required && item.sourceColumn === "__DEFAULT__" && item.defaultValue === undefined ? "fieldError" : ""}>
                <span>{fieldLabels[item.canonicalField] ?? item.canonicalField}{item.required ? " *" : ""}</span>
                <select value={item.sourceColumn} onChange={(event) => updateMapping(index, event.target.value)}>
                  <option value="__DEFAULT__">
                    {item.defaultValue === null ? "Không có / N/A"
                      : item.defaultValue !== undefined ? `Giá trị cố định: ${String(item.defaultValue)}`
                        : "— Chưa map —"}
                  </option>
                  {headers.map((header) => <option key={header} value={header}>{header}</option>)}
                </select>
              </label>
            ))}
          </div>

          <div className="mappingEditors">
            <div className="mappingEditor">
              <div className="mappingEditorTitle">
                <div><strong>Supporting metrics</strong><span>Dùng được trong KPI custom và AI diagnostics.</span></div>
                <button
                  className="iconAction"
                  aria-label="Thêm supporting metric"
                  onClick={() => setMetricMappings((current) => [...current, {
                    metricKey: `customMetric${current.length + 1}`,
                    sourceColumn: headers[0] ?? ""
                  }])}
                ><Plus size={15} /></button>
              </div>
              {metricMappings.length === 0 && <p className="emptyMapping">Chưa phát hiện · có thể thêm thủ công.</p>}
              {metricMappings.map((item, index) => (
                <div className="mappingPair" key={`${item.metricKey}-${index}`}>
                  <input
                    aria-label={`Metric key ${index + 1}`}
                    value={item.metricKey}
                    onChange={(event) => setMetricMappings((current) => current.map((entry, entryIndex) =>
                      entryIndex === index ? { ...entry, metricKey: event.target.value.replace(/\s+/g, "") } : entry
                    ))}
                  />
                  <select
                    aria-label={`Source column for ${item.metricKey}`}
                    value={item.sourceColumn}
                    onChange={(event) => setMetricMappings((current) => current.map((entry, entryIndex) =>
                      entryIndex === index ? { ...entry, sourceColumn: event.target.value } : entry
                    ))}
                  >
                    {headers.map((header) => <option key={header} value={header}>{header}</option>)}
                  </select>
                  <button className="iconAction dangerIcon" aria-label={`Xóa metric ${item.metricKey}`} onClick={() => setMetricMappings((current) => current.filter((_, entryIndex) => entryIndex !== index))}><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
            <div className="mappingEditor">
              <div className="mappingEditorTitle">
                <div><strong>Context dimensions</strong><span>Objective, learning, creative/post hoặc breakdown.</span></div>
                <button
                  className="iconAction"
                  aria-label="Thêm context dimension"
                  onClick={() => setDimensionMappings((current) => [...current, {
                    dimensionKey: `customDimension${current.length + 1}`,
                    sourceColumn: headers[0] ?? ""
                  }])}
                ><Plus size={15} /></button>
              </div>
              {dimensionMappings.length === 0 && <p className="emptyMapping">Chưa phát hiện · có thể thêm thủ công.</p>}
              {dimensionMappings.map((item, index) => (
                <div className="mappingPair" key={`${item.dimensionKey}-${index}`}>
                  <input
                    aria-label={`Dimension key ${index + 1}`}
                    value={item.dimensionKey}
                    onChange={(event) => setDimensionMappings((current) => current.map((entry, entryIndex) =>
                      entryIndex === index ? { ...entry, dimensionKey: event.target.value.replace(/\s+/g, "") } : entry
                    ))}
                  />
                  <select
                    aria-label={`Source column for ${item.dimensionKey}`}
                    value={item.sourceColumn}
                    onChange={(event) => setDimensionMappings((current) => current.map((entry, entryIndex) =>
                      entryIndex === index ? { ...entry, sourceColumn: event.target.value } : entry
                    ))}
                  >
                    {headers.map((header) => <option key={header} value={header}>{header}</option>)}
                  </select>
                  <button className="iconAction dangerIcon" aria-label={`Xóa dimension ${item.dimensionKey}`} onClick={() => setDimensionMappings((current) => current.filter((_, entryIndex) => entryIndex !== index))}><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          </div>

          <div className="cardActions">
            <span className="helperText">Strict: có 1 lỗi thì không lưu batch. Partial: chỉ lưu dòng hợp lệ.</span>
            <button className="primaryAction" disabled={busy || gaps.length > 0} onClick={validateAndImport}>
              <FileSpreadsheet size={17} />
              {busy ? batchProgress ? `Đang lưu ${batchProgress.completed}/${batchProgress.total} batch…` : "Đang chuẩn hóa…" : "Validate & import"}
            </button>
          </div>
        </section>
      )}

      {errors.length > 0 && (
        <section className="sectionCard">
          <div className="sectionHeader">
            <div>
              <span className="sectionKicker">IMPORT QC</span>
              <h2>Lỗi cần xử lý</h2>
              <p>{errors.length.toLocaleString("vi-VN")} lỗi trên {new Set(errors.map((item) => item.row)).size.toLocaleString("vi-VN")} dòng.</p>
            </div>
          </div>
          <div className="issueChips">
            {errorSummary.map(([code, count]) => <span key={code}>{code} · {count}</span>)}
          </div>
          <div className="tableScroller">
            <table className="dataTable">
              <thead><tr><th>Dòng</th><th>Field</th><th>Mã lỗi</th><th>Giá trị</th></tr></thead>
              <tbody>
                {errors.slice(0, 100).map((error, index) => (
                  <tr key={`${error.row}-${error.field}-${index}`}>
                    <td className="mono">{error.row}</td>
                    <td>{error.field}</td>
                    <td><span className="statusBadge danger">{error.code}</span></td>
                    <td className="mono">{String(error.value ?? "N/A")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
