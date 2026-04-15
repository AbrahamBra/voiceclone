import { writable, get } from "svelte/store";

const STORAGE_KEY = "vc_session";

export const accessCode = writable("");
export const sessionToken = writable(null);
export const client = writable(null);
export const isAdmin = writable(false);
export const isHydrated = writable(false);

// Hydrate from localStorage on module load
if (typeof localStorage !== "undefined") {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      if (saved.accessCode) accessCode.set(saved.accessCode);
      if (saved.sessionToken) sessionToken.set(saved.sessionToken);
    }
  } catch {
    // ignore corrupt data
  }
}
isHydrated.set(true);

// Persist on change
if (typeof localStorage !== "undefined") {
  accessCode.subscribe((code) => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const saved = raw ? JSON.parse(raw) : {};
      saved.accessCode = code;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    } catch {
      // ignore
    }
  });

  sessionToken.subscribe((token) => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const saved = raw ? JSON.parse(raw) : {};
      saved.sessionToken = token;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    } catch {
      // ignore
    }
  });
}

export function logout() {
  accessCode.set("");
  sessionToken.set(null);
  client.set(null);
  isAdmin.set(false);
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(STORAGE_KEY);
  }
}
