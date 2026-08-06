"use client";

import { useEffect, useState, useCallback } from "react";
import { Bot, Plus, Trash2, X, Eye, EyeOff } from "lucide-react";
import { apiJson } from "@/product/api";

export type Provider = {
  id: string;
  name: string;
  kind: string;
  baseUrl: string;
  models: string[];
  maskedKey: string; // "sk-****...1234"
};

export type ProviderFormState = {
  name: string;
  kind: "openai" | "anthropic" | "gemini";
  baseUrl: string;
  apiKey: string;
  models: string;
};

export type ProviderDialogProps = {
  onProvidersChange?: (providers: Provider[]) => void;
};

const DEFAULT_BASE_URLS = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
  gemini: "https://generativelanguage.googleapis.com"
};

const INITIAL_FORM: ProviderFormState = {
  name: "",
  kind: "openai",
  baseUrl: DEFAULT_BASE_URLS.openai,
  apiKey: "",
  models: "gpt-4.1-mini, gpt-4.1"
};

export function ProviderDialog({ onProvidersChange }: ProviderDialogProps = {}) {
  const [open, setOpen] = useState(false);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [form, setForm] = useState<ProviderFormState>(INITIAL_FORM);
  const [showApiKey, setShowApiKey] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchProviders = useCallback(async () => {
    try {
      setError(null);
      const res = await apiJson<{ providers: Array<Record<string, any>> }>("/api/ai/providers");
      const list: Provider[] = (res.providers || []).map((p) => ({
        id: p.id || p.provider_id || "",
        name: p.name || "",
        kind: p.kind || "",
        baseUrl: p.baseUrl || p.base_url || "",
        models: Array.isArray(p.models) ? p.models : [],
        maskedKey: p.maskedKey || p.apiKeyMasked || "••••••••"
      }));
      setProviders(list);
      onProvidersChange?.(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load providers");
    }
  }, [onProvidersChange]);

  useEffect(() => {
    if (open) {
      fetchProviders();
    }
  }, [open, fetchProviders]);

  function handleKindChange(kind: ProviderFormState["kind"]) {
    setForm((prev) => ({
      ...prev,
      kind,
      baseUrl: DEFAULT_BASE_URLS[kind] || prev.baseUrl
    }));
  }

  async function handleAddProvider(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!form.name.trim()) {
      setError("Provider name is required");
      return;
    }
    if (!form.apiKey.trim()) {
      setError("API key is required");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const mappedKind =
        form.kind === "anthropic" ? "ANTHROPIC" :
        form.kind === "gemini" ? "GEMINI" : "OPENAI_COMPATIBLE";

      const modelsArray = form.models
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      await apiJson("/api/ai/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          kind: mappedKind,
          baseUrl: form.baseUrl.trim() || DEFAULT_BASE_URLS[form.kind],
          apiKey: form.apiKey.trim(),
          models: modelsArray.length ? modelsArray : ["gpt-4.1-mini"]
        })
      });

      setForm(INITIAL_FORM);
      setShowApiKey(false);
      await fetchProviders();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save provider");
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteProvider(providerId: string) {
    if (!confirm("Are you sure you want to delete this provider?")) return;
    setLoading(true);
    setError(null);
    try {
      await apiJson("/api/ai/providers", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId })
      });
      await fetchProviders();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete provider");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button className="secondaryButton" onClick={() => setOpen(true)}>
        <Bot size={16} /> AI providers
      </button>
      {open && (
        <div className="modalBackdrop" role="presentation" onMouseDown={() => setOpen(false)}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="provider-title" onMouseDown={(event) => event.stopPropagation()}>
            <header className="modalHeader">
              <div>
                <p className="eyebrow">ADMIN CONFIGURATION</p>
                <h2 id="provider-title">AI model providers</h2>
              </div>
              <button className="iconButton" aria-label="Đóng" onClick={() => setOpen(false)}><X size={18} /></button>
            </header>
            <p className="muted">Mỗi provider có endpoint, API key và danh sách model riêng. Key thật sẽ được mã hóa phía server trước khi lưu.</p>

            {error && (
              <div style={{ color: "#ef4444", marginBottom: "1rem", fontSize: "0.875rem" }}>
                {error}
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "1.5rem" }}>
              {providers.length === 0 ? (
                <p className="muted" style={{ fontStyle: "italic" }}>Chưa có provider nào được cấu hình.</p>
              ) : (
                providers.map((p) => (
                  <div key={p.id} className="providerCard" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                      <div className="providerLogo">{p.kind.slice(0, 2).toUpperCase()}</div>
                      <div>
                        <strong>{p.name}</strong>
                        <span style={{ display: "block", fontSize: "0.75rem", color: "#6b7280" }}>
                          {p.kind} · Key: {p.maskedKey} · Models: {p.models.join(", ")}
                        </span>
                      </div>
                    </div>
                    <button
                      className="iconButton"
                      style={{ color: "#ef4444" }}
                      aria-label="Xóa provider"
                      onClick={() => handleDeleteProvider(p.id)}
                      disabled={loading}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))
              )}
            </div>

            <form onSubmit={handleAddProvider}>
              <h3 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem" }}>Thêm provider mới</h3>
              <div className="formGrid">
                <label>
                  Tên provider *
                  <input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="OpenAI Production"
                    required
                  />
                </label>
                <label>
                  Loại API
                  <select
                    value={form.kind}
                    onChange={(e) => handleKindChange(e.target.value as ProviderFormState["kind"])}
                  >
                    <option value="openai">OpenAI compatible</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="gemini">Gemini</option>
                  </select>
                </label>
                <label>
                  Base URL
                  <input
                    value={form.baseUrl}
                    onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                    placeholder="https://api.openai.com/v1"
                  />
                </label>
                <label className="full">
                  API key *
                  <div className="inputWithIcon" style={{ position: "relative" }}>
                    <input
                      type={showApiKey ? "text" : "password"}
                      value={form.apiKey}
                      onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                      placeholder="sk-••••••••••••••••"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey(!showApiKey)}
                      style={{ position: "absolute", right: "8px", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#6b7280" }}
                      aria-label={showApiKey ? "Ẩn API key" : "Hiện API key"}
                    >
                      {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </label>
                <label className="full">
                  Models (phân cách bằng dấu phẩy)
                  <input
                    value={form.models}
                    onChange={(e) => setForm({ ...form, models: e.target.value })}
                    placeholder="gpt-4.1-mini, gpt-4.1"
                  />
                </label>
              </div>

              <footer className="modalFooter" style={{ marginTop: "1.5rem" }}>
                <button type="button" className="secondaryButton" onClick={() => setOpen(false)}>
                  Hủy
                </button>
                <button type="submit" className="primaryButton" disabled={loading}>
                  <Plus size={16} /> {loading ? "Đang lưu..." : "Thêm provider"}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
