import { writable } from "svelte/store";

export const currentPersonaId = writable("");
export const personaConfig = writable(null);
export const personas = writable([]);
export const canCreateClone = writable(false);
