import { apiJson } from "./api";

export type TeamApi = <T>(url: string, init?: RequestInit) => Promise<T>;

export function createTeamApi(accessToken: string, organizationId: string): TeamApi {
  return (url, init = {}) => {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${accessToken}`);
    headers.set("x-organization-id", organizationId);
    return apiJson(url, { ...init, headers });
  };
}
