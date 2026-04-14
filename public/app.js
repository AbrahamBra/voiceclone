let config = null;
let accessCode = "";
let currentScenario = "";
let currentPersonaId = "";
let history = [];

const $ = (id) => document.getElementById(id);

function renderMarkdown(text) {
  return text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/^---$/gm, "<hr>")
    .replace(/^[-•] (.+)$/gm, "<li>$1</li>")
    .replace(/^(\d+)[.)]\s+(.+)$/gm, "<li>$2</li>")
    .replace(/((?:<li>.*<\/li>\n?)+)/g, "<ul>$1</ul>")
    .replace(/▶/g, "&#9654;").replace(/→/g, "&#8594;")
    .replace(/\n/g, "<br>");
}

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  $(id).classList.add("active");
}

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme.accent) root.style.setProperty("--accent", theme.accent);
  if (theme.background) root.style.setProperty("--bg", theme.background);
  if (theme.surface) root.style.setProperty("--surface", theme.surface);
  if (theme.text) root.style.setProperty("--text", theme.text);
}

function showToast(msg, duration = 3000) {
  const toast = $("chat-toast");
  toast.textContent = msg;
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), duration);
}

// ---- Screen 0: Access ----
$("access-btn").addEventListener("click", doAccess);
$("access-code").addEventListener("keydown", (e) => { if (e.key === "Enter") doAccess(); });

async function doAccess() {
  const code = $("access-code").value.trim();
  if (!code) return;
  const errorEl = $("access-error");
  errorEl.classList.add("hidden");

  try {
    const resp = await fetch("/api/personas", { headers: { "x-access-code": code } });
    if (resp.status === 403) {
      errorEl.textContent = "Code d'acces invalide";
      errorEl.classList.remove("hidden");
      $("access-code").classList.add("shake");
      setTimeout(() => $("access-code").classList.remove("shake"), 400);
      return;
    }
    if (!resp.ok) throw new Error("Server error");

    accessCode = code;
    const data = await resp.json();
    showPersonaList(data.personas, data.canCreateClone, data.isAdmin);
  } catch {
    errorEl.textContent = "Erreur de connexion";
    errorEl.classList.remove("hidden");
  }
}

function showPersonaList(personas, canCreateClone, isAdmin) {
  const container = $("persona-list");
  container.innerHTML = "";
  container.classList.remove("hidden");
  document.querySelector(".access-form").classList.add("hidden");
  document.querySelector(".access-card h1").textContent = "Choisissez un client";
  document.querySelector(".access-card .subtitle").textContent = "";

  for (const p of personas) {
    const card = document.createElement("div");
    card.className = "persona-card";
    card.innerHTML = `<div class="persona-card-avatar">${p.avatar}</div><div><strong>${p.name}</strong><br><span class="persona-card-title">${p.title || ""}</span></div>`;
    card.addEventListener("click", () => selectPersona(p.id));
    container.appendChild(card);
  }

  // "Creer un clone" button
  if (canCreateClone || isAdmin) {
    const createCard = document.createElement("div");
    createCard.className = "persona-card persona-card-create";
    createCard.innerHTML = `<div class="persona-card-avatar">+</div><div><strong>Creer un clone</strong><br><span class="persona-card-title">A partir d'un profil LinkedIn</span></div>`;
    createCard.addEventListener("click", () => showScreen("screen-create"));
    container.appendChild(createCard);
  }
}

async function selectPersona(personaId) {
  currentPersonaId = personaId;
  try {
    const resp = await fetch(`/api/config?persona=${personaId}`, { headers: { "x-access-code": accessCode } });
    if (!resp.ok) throw new Error("Failed to load persona");
    config = await resp.json();
    document.title = `${config.name} — Clone IA`;
    applyTheme(config.theme);
    setupScenarios();
    const keys = Object.keys(config.scenarios);
    if (keys.length === 1) startChat(keys[0]);
    else showScreen("screen-scenarios");
  } catch {
    showToast("Erreur de chargement du client");
  }
}

// ---- Screen 1: Clone creation ----
$("clone-submit").addEventListener("click", createClone);

async function createClone() {
  const linkedin = $("clone-linkedin").value.trim();
  const postsRaw = $("clone-posts").value.trim();
  const docs = $("clone-docs").value.trim();

  if (linkedin.length < 50) { showStatus("Profil LinkedIn trop court (min 50 caracteres)"); return; }
  const posts = postsRaw.split(/\n---\n/).map(p => p.trim()).filter(p => p.length > 30);
  if (posts.length < 3) { showStatus("Minimum 3 posts (separes par ---)"); return; }

  const btn = $("clone-submit");
  btn.disabled = true;
  btn.textContent = "Generation en cours...";
  showStatus("Analyse du style en cours, ca prend 20-30 secondes...");

  try {
    const resp = await fetch("/api/clone", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-access-code": accessCode },
      body: JSON.stringify({ linkedin_text: linkedin, posts, documents: docs || undefined }),
    });

    if (resp.status === 402) {
      showStatus("Budget depasse. Ajoutez votre cle API dans les parametres.");
      btn.disabled = false; btn.textContent = "Generer le clone";
      return;
    }
    if (resp.status === 403) {
      const data = await resp.json();
      showStatus(data.error || "Limite de clones atteinte");
      btn.disabled = false; btn.textContent = "Generer le clone";
      return;
    }
    if (!resp.ok) throw new Error("Server error");

    const data = await resp.json();
    showStatus(`Clone "${data.persona.name}" cree avec succes !`);
    btn.textContent = "Clone cree !";

    // Go to persona selection after 1.5s
    setTimeout(() => { doAccess(); }, 1500);
  } catch (err) {
    showStatus("Erreur: " + err.message);
    btn.disabled = false;
    btn.textContent = "Generer le clone";
  }
}

function showStatus(msg) {
  const el = $("clone-status");
  el.textContent = msg;
  el.classList.remove("hidden");
}

// ---- Screen 2: Scenarios ----
function setupScenarios() {
  const container = $("scenario-cards");
  container.innerHTML = "";
  for (const [key, val] of Object.entries(config.scenarios)) {
    const card = document.createElement("div");
    card.className = "scenario-card";
    card.innerHTML = `<h3>${val.label}</h3><p>${val.description}</p>`;
    card.addEventListener("click", () => startChat(key));
    container.appendChild(card);
  }
}

// ---- Screen 3: Chat ----
function startChat(scenario) {
  currentScenario = scenario;
  history = [];
  $("chat-avatar").textContent = config.avatar;
  $("chat-name").textContent = config.name;
  $("chat-messages").innerHTML = "";
  const sc = config.scenarios[scenario];
  addMessage("bot", sc?.welcome || `Bonjour, je suis ${config.name}. Comment puis-je vous aider ?`);
  showScreen("screen-chat");
  $("chat-input").focus();
}

function addMessage(role, text) {
  const container = $("chat-messages");
  const div = document.createElement("div");
  div.className = `msg msg-${role}`;
  if (role === "bot") {
    div.innerHTML = renderMarkdown(text);
    if (history.length > 0 || container.children.length > 1) {
      const fb = document.createElement("button");
      fb.className = "feedback-btn";
      fb.textContent = "Corriger";
      fb.addEventListener("click", () => openFeedback(div, text));
      div.appendChild(fb);
    }
  } else div.textContent = text;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
}

function openFeedback(msgDiv, botText) {
  const lastUser = history.length > 0 ? history[history.length - 1]?.content || "" : "";
  const overlay = document.createElement("div");
  overlay.className = "feedback-overlay";
  overlay.innerHTML = `<div class="feedback-modal"><h3>Corriger cette reponse</h3><p class="feedback-hint">Le clone apprendra de cette correction.</p><textarea id="feedback-text" placeholder="Ex: Trop formel, pas assez direct..." rows="3"></textarea><div class="feedback-actions"><button class="feedback-cancel">Annuler</button><button class="feedback-submit">Envoyer</button></div></div>`;
  document.body.appendChild(overlay);
  overlay.querySelector(".feedback-cancel").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector(".feedback-submit").addEventListener("click", async () => {
    const correction = overlay.querySelector("#feedback-text").value.trim();
    if (!correction) return;
    const btn = overlay.querySelector(".feedback-submit");
    btn.disabled = true; btn.textContent = "Envoi...";
    try {
      const resp = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-access-code": accessCode },
        body: JSON.stringify({ correction, botMessage: botText, userMessage: lastUser, persona: currentPersonaId }),
      });
      if (resp.ok) { showToast("Correction enregistree ;)"); overlay.remove(); }
      else { btn.disabled = false; btn.textContent = "Envoyer"; }
    } catch { btn.disabled = false; btn.textContent = "Envoyer"; }
  });
  setTimeout(() => overlay.querySelector("#feedback-text").focus(), 100);
}

// Settings modal
$("settings-btn").addEventListener("click", openSettings);

async function openSettings() {
  // Fetch usage
  let usage = { budget_cents: 0, spent_cents: 0, remaining_cents: 0, has_own_key: false };
  try {
    const resp = await fetch("/api/usage", { headers: { "x-access-code": accessCode } });
    if (resp.ok) usage = await resp.json();
  } catch { }

  const overlay = document.createElement("div");
  overlay.className = "feedback-overlay";
  overlay.innerHTML = `<div class="feedback-modal"><h3>Parametres</h3>
    <p class="feedback-hint">Budget : ${(usage.spent_cents / 100).toFixed(2)}€ / ${(usage.budget_cents / 100).toFixed(2)}€ utilises${usage.has_own_key ? " (cle perso active)" : ""}</p>
    <div class="create-step"><label>Cle API Anthropic (optionnel)</label><input type="text" id="settings-apikey" placeholder="sk-ant-..." style="width:100%;padding:0.5rem;background:var(--bg);border:1px solid #333;border-radius:8px;color:var(--text);font-size:0.85rem;"></div>
    <div class="feedback-actions"><button class="feedback-cancel">Fermer</button><button class="feedback-submit" id="settings-save">Sauvegarder</button></div></div>`;
  document.body.appendChild(overlay);
  overlay.querySelector(".feedback-cancel").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector("#settings-save").addEventListener("click", async () => {
    const key = overlay.querySelector("#settings-apikey").value.trim();
    if (!key) { overlay.remove(); return; }
    try {
      const resp = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-access-code": accessCode },
        body: JSON.stringify({ anthropic_api_key: key }),
      });
      if (resp.ok) { showToast("Cle API sauvegardee"); overlay.remove(); }
    } catch { }
  });
}

// Chat send
$("chat-send").addEventListener("click", sendMessage);
$("chat-input").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
$("chat-input").addEventListener("input", function () { this.style.height = "auto"; this.style.height = Math.min(this.scrollHeight, 120) + "px"; });

let sending = false;

async function sendMessage() {
  if (sending) return;
  const input = $("chat-input");
  const text = input.value.trim();
  if (!text) return;

  sending = true;
  input.value = ""; input.style.height = "auto";
  $("chat-send").disabled = true;

  addMessage("user", text);
  const botDiv = addMessage("bot", "");
  botDiv.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';

  try {
    const resp = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-access-code": accessCode },
      body: JSON.stringify({ message: text, history, scenario: currentScenario, persona: currentPersonaId }),
    });

    if (resp.status === 429) { showToast("Trop de messages, patientez"); botDiv.remove(); sending = false; $("chat-send").disabled = false; return; }
    if (resp.status === 402) {
      botDiv.innerHTML = '<strong>Budget depasse.</strong><br>Ajoutez votre cle API Anthropic dans les parametres (&#9881;) pour continuer.';
      sending = false; $("chat-send").disabled = false; return;
    }
    if (!resp.ok) throw new Error("Server error");

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let botText = "", statusEl = null, buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n"); buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const evt = JSON.parse(line.slice(6));
          switch (evt.type) {
            case "delta":
              if (!botText && botDiv.querySelector(".typing-indicator")) botDiv.innerHTML = "";
              botText += evt.text;
              botDiv.innerHTML = renderMarkdown(botText);
              if (statusEl) botDiv.appendChild(statusEl);
              break;
            case "validating":
              statusEl = document.createElement("div"); statusEl.className = "status"; statusEl.textContent = "Verification...";
              botDiv.appendChild(statusEl); break;
            case "rewriting": if (statusEl) statusEl.textContent = "Amelioration..."; break;
            case "clear": botText = ""; botDiv.innerHTML = ""; if (statusEl) botDiv.appendChild(statusEl); break;
            case "done": if (statusEl) statusEl.remove(); statusEl = null; break;
            case "error":
              botDiv.textContent = "Connexion perdue. ";
              const rb = document.createElement("button"); rb.textContent = "Reessayer";
              rb.style.cssText = "background:var(--accent);color:#fff;border:none;border-radius:6px;padding:4px 12px;cursor:pointer;";
              rb.addEventListener("click", () => { botDiv.remove(); $("chat-input").value = text; sendMessage(); });
              botDiv.appendChild(rb); break;
          }
        } catch { }
      }
      $("chat-messages").scrollTop = $("chat-messages").scrollHeight;
    }

    history.push({ role: "user", content: text });
    history.push({ role: "assistant", content: botText });
    if (history.length > 20) history = history.slice(history.length - 20);
  } catch {
    if (!botDiv.querySelector("button")) botDiv.textContent = "Connexion perdue. Reessayez.";
  }
  sending = false; $("chat-send").disabled = false; input.focus();
}
