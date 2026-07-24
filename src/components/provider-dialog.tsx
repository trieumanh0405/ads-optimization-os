"use client";

import { useState } from "react";
import { Bot, Plus, X } from "lucide-react";

export function ProviderDialog() {
  const [open, setOpen] = useState(false);
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
            <div className="providerCard">
              <div className="providerLogo">AI</div>
              <div><strong>OpenAI compatible</strong><span>OpenAI · Gemini gateway · OpenRouter · self-hosted</span></div>
              <span className="statusDot">Ready</span>
            </div>
            <div className="formGrid">
              <label>Provider name<input placeholder="OpenAI Production" /></label>
              <label>Base URL<input placeholder="https://api.openai.com/v1" /></label>
              <label className="full">API key<input type="password" placeholder="••••••••••••••••" /></label>
              <label className="full">Models<input placeholder="gpt-4.1-mini, gpt-4.1" /></label>
            </div>
            <footer className="modalFooter">
              <button className="secondaryButton"><Plus size={16}/> Add provider</button>
              <button className="primaryButton" onClick={() => setOpen(false)}>Save configuration</button>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}
