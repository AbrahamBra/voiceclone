// In-memory per-persona cache for the chat view.
//
// Purpose : rendre le switch de clone instantané quand on revient sur un clone
// déjà visité. On stocke la config, la liste des conversations, et l'état de
// la dernière conversation ouverte (messages + scenario) tel qu'il était au
// moment où l'utilisateur a quitté le clone.
//
// Pattern : stale-while-revalidate. L'appelant peint depuis le cache, puis
// refetch en parallèle ; si les données reviennent différentes, il applique
// la version fraîche.
//
// Invalidation : on ne cherche pas à maintenir le cache à jour pendant la
// session. À chaque sortie de clone (switch → autre clone, navigation hub),
// on snapshot l'état courant. À l'entrée, on repeint le snapshot puis SWR.

/**
 * @typedef {Object} LastConvSnapshot
 * @property {string} id
 * @property {Array<any>} messages       Client-side messages array (role: "user"|"bot")
 * @property {string} scenario           Legacy scenario key ("post"|"dm"|"default"|…)
 * @property {string|null} scenarioType  Canonical ScenarioId
 */

/**
 * @typedef {Object} PersonaCacheEntry
 * @property {any=} config               /api/config response
 * @property {Array<any>=} convList      /api/conversations?persona= list
 * @property {LastConvSnapshot|null=} lastConv
 */

/** @type {Map<string, PersonaCacheEntry>} */
const cache = new Map();

/** @param {string} personaId */
export function getPersonaCache(personaId) {
  if (!personaId) return null;
  return cache.get(personaId) || null;
}

/**
 * Merge-update entry for a persona. Keys absent from `patch` are preserved.
 * @param {string} personaId
 * @param {Partial<PersonaCacheEntry>} patch
 */
export function setPersonaCache(personaId, patch) {
  if (!personaId) return;
  const prev = cache.get(personaId) || {};
  cache.set(personaId, { ...prev, ...patch });
}

/** @param {string} personaId */
export function invalidatePersonaCache(personaId) {
  if (!personaId) return;
  cache.delete(personaId);
}

/**
 * Drop only the conv-bound parts (list + lastConv) but keep config cached.
 * Use after a mutation that changes conversations (send, new conv, delete)
 * but not the clone's brain/voice.
 * @param {string} personaId
 */
export function invalidateConvs(personaId) {
  if (!personaId) return;
  const prev = cache.get(personaId);
  if (!prev) return;
  cache.set(personaId, { ...prev, convList: undefined, lastConv: null });
}
