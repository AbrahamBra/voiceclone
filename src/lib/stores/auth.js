import { writable, get } from "svelte/store";

const STORAGE_KEY = "vc_session";

export const accessCode = writable("");
export const sessionToken = writable(null);
export const client = writable(null);
export const isAdmin = writable(false);
export const clientName = writable("");
export const isHydrated = writable(false);

// Hydrate from localStorage on module load
if (typeof localStorage !== "undefined") {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      if (saved.accessCode) accessCode.set(saved.accessCode);
      if (saved.sessionToken) sessionToken.set(saved.sessionToken);
      if (saved.isAdmin) isAdmin.set(true);
      if (saved.clientName) clientName.set(saved.clientName);
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

  isAdmin.subscribe((val) => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const saved = raw ? JSON.parse(raw) : {};
      saved.isAdmin = !!val;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    } catch {
      // ignore
    }
  });

  clientName.subscribe((val) => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const saved = raw ? JSON.parse(raw) : {};
      saved.clientName = val || "";
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
  clientName.set("");
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(STORAGE_KEY);
    // Mémorisation du dernier clone visité : purge au logout pour éviter
    // qu'un autre compte partageant le navigateur reroute sur un clone
    // auquel il n'a pas accès. Both keys removed during the rename
    // migration window (vc_ → setclone_).
    localStorage.removeItem("setclone_last_persona");
    localStorage.removeItem("vc_last_persona");
  }
}
