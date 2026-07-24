import { adminAuth } from "./firebase-admin";

export type AppUser = { uid: string; organizationId: string; role: "admin" | "leader" | "buyer" | "reviewer" };

export async function requireUser(request: Request, roles?: AppUser["role"][]): Promise<AppUser> {
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token) throw new Error("AUTH_TOKEN_REQUIRED");
  const decoded = await adminAuth().verifyIdToken(token);
  const organizationId = typeof decoded.organizationId === "string" ? decoded.organizationId : "";
  const role = decoded.role as AppUser["role"];
  if (!organizationId || !["admin", "leader", "buyer", "reviewer"].includes(role)) throw new Error("AUTH_CLAIMS_INVALID");
  if (roles && !roles.includes(role)) throw new Error("AUTH_FORBIDDEN");
  return { uid: decoded.uid, organizationId, role };
}
