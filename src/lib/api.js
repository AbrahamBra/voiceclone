import { get } from "svelte/store";
import { accessCode, sessionToken, logout } from "./stores/auth.js";

export function authHeaders(extra = {}) {
  const h = { ...extra };
  const token = get(sessionToken);
  const code = get(accessCode);
  if (token) h["x-session-token"] = token;
  if (code) h["x-access-code"] = code;
  return h;
}

export async function api(path, opts = {}) {
  const { headers: extraHeaders, ...rest } = opts;
  const resp = await fetch(path, {
    ...rest,
    headers: authHeaders({ "Content-Type": "application/json", ...extraHeaders }),
  });
  if (resp.status === 401) {
    logout();
    throw new Error("Unauthorized");
  }
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch {
    throw new Error(resp.ok ? "Invalid server response" : `Server error (${resp.status})`);
  }
  if (!resp.ok) {
    const err = new Error(data.error || "Request failed");
    err.status = resp.status;
    err.data = data;
    throw err;
  }
  return data;
}

export async function apiStream(path, opts = {}) {
  const { headers: extraHeaders, ...rest } = opts;
  const resp = await fetch(path, {
    ...rest,
    headers: authHeaders({ "Content-Type": "application/json", ...extraHeaders }),
  });
  if (resp.status === 401) {
    logout();
    throw new Error("Unauthorized");
  }
  return resp;
}
