import { writable } from "svelte/store";

export const messages = writable([]);
export const currentConversationId = writable(null);
export const conversations = writable([]);
export const currentScenario = writable("");
export const sending = writable(false);
