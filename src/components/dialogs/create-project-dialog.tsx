import { Plus, X } from "lucide-react";
import type { ProjectCreateInput } from "@/product/types";

export type CreateProjectDialogProps = {
  open: boolean;
  onClose: () => void;
  createInput: ProjectCreateInput;
  onCreateInputChange: (input: ProjectCreateInput) => void;
  onSubmit: () => void;
};

export function CreateProjectDialog({
  open,
  onClose,
  createInput,
  onCreateInputChange,
  onSubmit,
}: CreateProjectDialogProps) {
  if (!open) return null;

  function patch<K extends keyof ProjectCreateInput>(key: K, value: ProjectCreateInput[K]) {
    onCreateInputChange({ ...createInput, [key]: value });
  }

  return (
    <div className="modalBackdrop" role="presentation" onMouseDown={onClose}>
      <section className="productModal wideModal" role="dialog" aria-modal="true" aria-labelledby="create-project-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modalTitle">
          <div><span className="sectionKicker">NEW BRAND WORKSPACE</span><h2 id="create-project-title">Tạo project</h2><p>Thông tin này tạo config, metric và rule set version 1.</p></div>
          <button className="iconAction" onClick={onClose} aria-label="Đóng"><X size={18} /></button>
        </div>
        <div className="formGrid">
          <label>Project / Brand name *
            <input autoFocus value={createInput.projectName} onChange={(event) => patch("projectName", event.target.value)} placeholder="BVIS · Lead Gen 2026" />
          </label>
          <label>Platform
            <select value={createInput.platform} onChange={(event) => patch("platform", event.target.value)}>
              <option value="META">Meta Ads</option>
              <option value="TIKTOK">TikTok Ads</option>
              <option value="GOOGLE">Google Ads</option>
              <option value="OTHER">Other</option>
            </select>
          </label>
          <label>Ad account ID *
            <input value={createInput.accountId} onChange={(event) => patch("accountId", event.target.value)} placeholder="act_123456789" />
          </label>
          <label>Project start date
            <input type="date" value={createInput.startDate} onChange={(event) => patch("startDate", event.target.value)} />
          </label>
          <label>Primary KPI
            <select value={createInput.primaryMetricKey} onChange={(event) => patch("primaryMetricKey", event.target.value)}>
              <option value="CPL">CPL · Cost per lead</option>
              <option value="CPQL">CPQL · Cost per qualified lead</option>
              <option value="CPA">CPA · Cost per acquisition</option>
              <option value="ROAS">ROAS</option>
              <option value="CTR">CTR</option>
              <option value="CPC">CPC</option>
              <option value="CVR">CVR</option>
              <option value="CPM">CPM</option>
            </select>
          </label>
          <label>Target KPI *
            <input type="number" min="0" value={createInput.target} onChange={(event) => patch("target", Number(event.target.value))} />
          </label>
          <label>Result nghĩa là
            <input value={createInput.optimizationEventLabel} onChange={(event) => patch("optimizationEventLabel", event.target.value)} placeholder="Lead / Message / Purchase / Booking" />
          </label>
          <label>Currency
            <select value={createInput.currency} onChange={(event) => patch("currency", event.target.value)}>
              <option value="VND">VND</option>
              <option value="USD">USD</option>
              <option value="SGD">SGD</option>
              <option value="THB">THB</option>
            </select>
          </label>
          <label>Sales model
            <select value={createInput.salesModel} onChange={(event) => patch("salesModel", event.target.value as ProjectCreateInput["salesModel"])}>
              <option value="ONLINE_CHECKOUT">Online checkout</option>
              <option value="LANDING_PAGE_OFFLINE_CLOSE">Landing page → sales close</option>
              <option value="MESSAGING_OFFLINE_CLOSE">Messenger/Zalo/phone</option>
              <option value="MARKETPLACE">Marketplace</option>
              <option value="MIXED">Mixed channels</option>
              <option value="AWARENESS_ONLY">Awareness only</option>
              <option value="OTHER">Other</option>
            </select>
          </label>
          <label>Conversion tracking
            <select value={createInput.trackingConfidence} onChange={(event) => patch("trackingConfidence", event.target.value as ProjectCreateInput["trackingConfidence"])}>
              <option value="UNKNOWN">Chưa xác minh</option>
              <option value="HIGH">High confidence</option>
              <option value="MEDIUM">Medium confidence</option>
              <option value="LOW">Low confidence</option>
            </select>
          </label>
        </div>
        <div className="modalActions">
          <button className="secondaryAction" onClick={onClose}>Hủy</button>
          <button className="primaryAction" onClick={onSubmit}><Plus size={16} /> Tạo project & rules</button>
        </div>
      </section>
    </div>
  );
}
