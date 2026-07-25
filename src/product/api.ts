export async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok && response.status !== 207) {
    const message = typeof payload.error === "string" ? payload.error
      : typeof payload.message === "string" ? payload.message
        : `REQUEST_FAILED_${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}

export function downloadText(fileName: string, text: string, type = "application/json"): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
