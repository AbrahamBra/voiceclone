import { writable } from "svelte/store";

export const toastMessage = writable("");

let toastTimer;

export function showToast(msg, duration = 3000) {
  clearTimeout(toastTimer);
  toastMessage.set(msg);
  toastTimer = setTimeout(() => toastMessage.set(""), duration);
}
