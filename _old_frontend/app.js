let config = null;
let accessCode = "";
let sessionToken = null;
let currentScenario = "";
let currentPersonaId = "";
let currentConversationId = null;

const $ = (id) => document.getElementById(id);

function authHeaders(extra = {}) {
  const h = { ...extra };
  if (sessionToken) h["x-session-token"] = sessionToken;
  else if (accessCode) h["x-access-code"] = accessCode;
  return h;
}

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

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
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
    if (data.session?.token) sessionToken = data.session.token;
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
    const resp = await fetch(`/api/config?persona=${personaId}`, { headers: authHeaders() });
    if (!resp.ok) throw new Error("Failed to load persona");
    config = await resp.json();
    document.title = `${config.name} — Clone IA`;
    applyTheme(config.theme);

    // Load existing conversations for picker
    let convs = [];
    try {
      const convResp = await fetch(`/api/conversations?persona=${personaId}`, { headers: authHeaders() });
      if (convResp.ok) { const d = await convResp.json(); convs = d.conversations || []; }
    } catch {}
    if (convs.length > 0) {
      showConversationPicker(convs);
    } else {
      setupScenarios();
      const keys = Object.keys(config.scenarios);
      if (keys.length === 1) startChat(keys[0]);
      else showScreen("screen-scenarios");
    }
  } catch {
    showToast("Erreur de chargement du client");
  }
}

function showConversationPicker(convs) {
  const container = $("scenario-cards");
  container.innerHTML = "";

  // "New conversation" card
  const newCard = document.createElement("div");
  newCard.className = "scenario-card";
  newCard.innerHTML = `<h3>+ Nouvelle conversation</h3><p>Commencer une discussion</p>`;
  newCard.addEventListener("click", () => {
    currentConversationId = null;
    localStorage.removeItem("conv_" + currentPersonaId);
    setupScenarios();
    const keys = Object.keys(config.scenarios);
    if (keys.length === 1) startChat(keys[0]);
    else showScreen("screen-scenarios");
  });
  container.appendChild(newCard);

  // Existing conversations
  for (const conv of convs.slice(0, 10)) {
    const card = document.createElement("div");
    card.className = "scenario-card";
    const date = new Date(conv.last_message_at).toLocaleDateString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    card.innerHTML = `<h3>${conv.title || "Conversation"}</h3><p>${date}</p>`;
    card.addEventListener("click", async () => {
      // Load full conversation with messages
      try {
        const resp = await fetch(`/api/conversations?id=${conv.id}`, {
          headers: authHeaders(),
        });
        if (resp.ok) {
          const data = await resp.json();
          if (data.conversation) {
            currentScenario = conv.scenario || "default";
            $("chat-avatar").textContent = config.avatar;
            $("chat-name").textContent = config.name;
            showScreen("screen-chat");
            resumeConversation(data.conversation);
            $("chat-input").focus();
            return;
          }
        }
      } catch { }
      showToast("Erreur de chargement");
    });
    container.appendChild(card);
  }

  document.querySelector("#screen-scenarios h2").textContent = config.name;
  showScreen("screen-scenarios");
}

// ---- Screen 1: Clone creation ----
// LinkedIn URL scraping
$("scrape-btn").addEventListener("click", scrapeLinkedIn);

async function scrapeLinkedIn() {
  const url = $("clone-url").value.trim();
  if (!url) return;

  const btn = $("scrape-btn");
  const status = $("scrape-status");
  btn.disabled = true;
  btn.textContent = "Scraping...";
  status.textContent = "Recuperation du profil et des posts...";
  status.classList.remove("hidden");

  try {
    const resp = await fetch("/api/scrape", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ linkedin_url: url }),
    });

    if (resp.status === 501) {
      status.textContent = "Scraping non disponible. Remplissez manuellement.";
      btn.disabled = false; btn.textContent = "Scraper";
      return;
    }
    if (!resp.ok) {
      const err = await resp.json();
      status.textContent = err.error || "Erreur de scraping";
      btn.disabled = false; btn.textContent = "Scraper";
      return;
    }

    const data = await resp.json();

    // Fill profile textarea
    $("clone-linkedin").value = data.profile.text;

    // Fill posts textarea
    if (data.posts.length > 0) {
      $("clone-posts").value = data.posts.slice(0, 15).join("\n---\n");
    }

    status.textContent = `${data.profile.name} — profil + ${data.postCount} posts recuperes`;
    status.style.color = "var(--success)";
    btn.textContent = "OK";
  } catch {
    status.textContent = "Erreur de connexion";
    btn.disabled = false;
    btn.textContent = "Scraper";
  }
}

// File upload handling
$("clone-file-btn").addEventListener("click", () => $("clone-file").click());
$("clone-file").addEventListener("change", handleFiles);

async function handleFiles(e) {
  const files = Array.from(e.target.files);
  const fileList = $("file-list");
  const docsArea = $("clone-docs");

  for (const file of files) {
    const ext = file.name.split(".").pop().toLowerCase();
    let text = "";

    try {
      if (ext === "txt" || ext === "csv") {
        text = await file.text();
      } else if (ext === "pdf") {
        text = await extractPdfText(file);
      } else if (ext === "docx") {
        text = await extractDocxText(file);
      } else {
        continue;
      }

      if (text.trim()) {
        // Show file in list
        const tag = document.createElement("div");
        tag.className = "file-tag";
        tag.textContent = `${file.name} (${(text.length / 1000).toFixed(1)}k chars)`;
        fileList.appendChild(tag);

        // Append to docs textarea
        docsArea.value += (docsArea.value ? "\n\n--- " + file.name + " ---\n\n" : "") + text.trim();
      }
    } catch (err) {
      const tag = document.createElement("div");
      tag.className = "file-tag file-tag-error";
      tag.textContent = `${file.name} — erreur de lecture`;
      fileList.appendChild(tag);
    }
  }
  e.target.value = ""; // Reset input
}

async function extractPdfText(file) {
  const arrayBuffer = await file.arrayBuffer();
  // Use pdf.js if available
  if (window.pdfjsLib) {
    const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let text = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map(item => item.str).join(" ") + "\n";
    }
    return text;
  }
  // Fallback: try to read as text
  return new TextDecoder().decode(arrayBuffer);
}

async function extractDocxText(file) {
  // DOCX is a ZIP of XML files — extract text from word/document.xml
  const arrayBuffer = await file.arrayBuffer();
  try {
    const blob = new Blob([arrayBuffer]);
    const text = await blob.text();
    // Simple XML text extraction
    return text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  } catch {
    return "";
  }
}

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
      headers: authHeaders({ "Content-Type": "application/json" }),
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

    // Start calibration instead of going back
    setTimeout(() => { startCalibration(data.persona.id); }, 1000);
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
  $("chat-avatar").textContent = config.avatar;
  $("chat-name").textContent = config.name;
  $("chat-messages").innerHTML = "";
  const sc = config.scenarios[scenario];
  addMessage("bot", sc?.welcome || `Bonjour, je suis ${config.name}. Comment puis-je vous aider ?`);
  showScreen("screen-chat");
  $("chat-input").focus();

  // Load conversation sidebar
  loadConversations(currentPersonaId);

  // Resume last conversation from localStorage (only if not explicitly starting new)
  if (currentConversationId === null) {
    const savedConvId = localStorage.getItem("conv_" + currentPersonaId);
    if (savedConvId) loadConversation(savedConvId);
  }
}

function addMessage(role, text) {
  const container = $("chat-messages");
  const div = document.createElement("div");
  div.className = `msg msg-${role}`;
  if (role === "bot") {
    const blocks = text.split(/\n\n+/);
    if (blocks.length > 1) {
      for (const block of blocks) {
        if (!block.trim()) continue;
        const wrapper = document.createElement("div");
        wrapper.className = "copyable-block";
        wrapper.innerHTML = renderMarkdown(block);
        const cpBtn = document.createElement("button");
        cpBtn.className = "block-copy-btn";
        cpBtn.textContent = "\u29C9";
        cpBtn.title = "Copier ce bloc";
        cpBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          navigator.clipboard.writeText(block);
          cpBtn.textContent = "\u2713";
          setTimeout(() => { cpBtn.textContent = "\u29C9"; }, 1500);
        });
        wrapper.appendChild(cpBtn);
        div.appendChild(wrapper);
      }
    } else {
      div.innerHTML = renderMarkdown(text);
    }

    if (container.children.length > 0) {
      const actions = document.createElement("div");
      actions.className = "msg-actions";

      const copyBtn = document.createElement("button");
      copyBtn.className = "action-btn";
      copyBtn.textContent = "Copier";
      copyBtn.addEventListener("click", () => {
        navigator.clipboard.writeText(text);
        copyBtn.textContent = "Copie !";
        lastCopiedMessage = { text, personaId: currentPersonaId };
        const diffLink = div.querySelector(".diff-link");
        if (diffLink) diffLink.classList.remove("hidden");
        setTimeout(() => { copyBtn.textContent = "Copier"; }, 1500);
      });
      actions.appendChild(copyBtn);

      const fb = document.createElement("button");
      fb.className = "action-btn";
      fb.textContent = "Corriger";
      fb.addEventListener("click", () => openFeedback(div, text));
      actions.appendChild(fb);

      div.appendChild(actions);

      const diffLink = document.createElement("a");
      diffLink.className = "diff-link hidden";
      diffLink.href = "#";
      diffLink.textContent = "Tu l'as modifie ? Colle ta version ici";
      diffLink.addEventListener("click", (e) => { e.preventDefault(); openImplicitFeedback(text); });
      div.appendChild(diffLink);
    }
  } else div.textContent = text;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
}

function openFeedback(msgDiv, botText) {
  const lastUser = "";
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
        headers: authHeaders({ "Content-Type": "application/json" }),
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
    const resp = await fetch("/api/usage", { headers: authHeaders() });
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
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ anthropic_api_key: key }),
      });
      if (resp.ok) { showToast("Cle API sauvegardee"); overlay.remove(); }
    } catch { }
  });
}

// ---- Calibration ----
let calibratePersonaId = null;
let calibrateMessages = [];

async function startCalibration(personaId) {
  calibratePersonaId = personaId;
  showScreen("screen-calibrate");
  $("calibrate-status").textContent = "Generation des messages de test...";
  $("calibrate-status").classList.remove("hidden");

  try {
    const resp = await fetch("/api/calibrate", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ persona: personaId }),
    });
    if (!resp.ok) throw new Error("Calibration failed");

    const data = await resp.json();
    calibrateMessages = data.messages;
    $("calibrate-status").classList.add("hidden");
    renderCalibrateCards(data.messages);
  } catch (err) {
    $("calibrate-status").textContent = "Calibration indisponible. Vous pouvez passer.";
    $("calibrate-status").style.color = "var(--warning)";
  }
}

function renderCalibrateCards(messages) {
  const container = $("calibrate-cards");
  container.innerHTML = "";
  messages.forEach((msg, i) => {
    const card = document.createElement("div");
    card.className = "calibrate-card";
    card.innerHTML = `
      <div class="calibrate-context">${msg.context}</div>
      <div class="calibrate-response">${renderMarkdown(msg.response)}</div>
      <div class="calibrate-rating" data-index="${i}">
        ${[1,2,3,4,5].map(n => `<button class="star-btn" data-score="${n}">${n <= 3 ? "&#9734;" : "&#9733;"}</button>`).join("")}
      </div>
      <textarea class="calibrate-correction" placeholder="Correction (optionnel)" rows="2"></textarea>
    `;
    // Star click handler
    card.querySelectorAll(".star-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const score = parseInt(btn.dataset.score);
        card.querySelectorAll(".star-btn").forEach((b, j) => {
          b.classList.toggle("active", j < score);
          b.innerHTML = j < score ? "&#9733;" : "&#9734;";
        });
        card.dataset.score = score;
      });
    });
    container.appendChild(card);
  });
}

$("calibrate-submit").addEventListener("click", async () => {
  const cards = document.querySelectorAll(".calibrate-card");
  const ratings = [];
  cards.forEach((card, i) => {
    ratings.push({
      index: i,
      score: parseInt(card.dataset.score) || 3,
      correction: card.querySelector(".calibrate-correction").value.trim(),
      response: calibrateMessages[i]?.response?.slice(0, 300) || "",
    });
  });

  const btn = $("calibrate-submit");
  btn.disabled = true;
  btn.textContent = "Envoi...";

  try {
    const resp = await fetch("/api/calibrate-feedback", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ persona: calibratePersonaId, ratings }),
    });
    if (resp.ok) {
      const data = await resp.json();
      showToast(data.message);
    }
  } catch { }

  // Go to persona selection
  setTimeout(() => { doAccess(); }, 500);
});

$("calibrate-skip").addEventListener("click", () => { doAccess(); });

// ---- Implicit feedback (diff) ----
let lastCopiedMessage = null;

function openImplicitFeedback(originalText) {
  const overlay = document.createElement("div");
  overlay.className = "feedback-overlay";
  overlay.innerHTML = `<div class="feedback-modal"><h3>Version modifiee</h3><p class="feedback-hint">Collez la version que vous avez envoyee. On detecte les differences automatiquement.</p><textarea id="implicit-text" rows="5" placeholder="Collez votre version modifiee ici...">${originalText}</textarea><div class="feedback-actions"><button class="feedback-cancel">Annuler</button><button class="feedback-submit">Envoyer le diff</button></div></div>`;
  document.body.appendChild(overlay);
  overlay.querySelector(".feedback-cancel").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector(".feedback-submit").addEventListener("click", async () => {
    const modified = overlay.querySelector("#implicit-text").value.trim();
    if (!modified || modified === originalText) { overlay.remove(); return; }
    const btn = overlay.querySelector(".feedback-submit");
    btn.disabled = true; btn.textContent = "Envoi...";
    try {
      const resp = await fetch("/api/feedback", {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          type: "implicit",
          original: originalText,
          modified,
          persona: currentPersonaId,
        }),
      });
      if (resp.ok) { showToast("Diff enregistre, le clone va s'ameliorer"); overlay.remove(); }
      else { btn.disabled = false; btn.textContent = "Envoyer le diff"; }
    } catch { btn.disabled = false; btn.textContent = "Envoyer le diff"; }
  });
  setTimeout(() => {
    const ta = overlay.querySelector("#implicit-text");
    ta.focus();
    ta.setSelectionRange(0, 0);
  }, 100);
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
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        message: text,
        scenario: currentScenario,
        persona: currentPersonaId,
        conversation_id: currentConversationId || undefined,
      }),
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
            case "thinking":
              if (!statusEl) {
                statusEl = document.createElement("div"); statusEl.className = "status";
              }
              statusEl.textContent = "Analyse du contexte...";
              botDiv.appendChild(statusEl); break;
            case "scoring": break; // legacy, ignored
            case "rewriting":
              if (statusEl) statusEl.textContent = `Amelioration (tentative ${evt.attempt || 1})...`;
              break;
            case "clear": botText = ""; botDiv.innerHTML = ""; if (statusEl) botDiv.appendChild(statusEl); break;
            case "done": {
              if (statusEl) statusEl.remove(); statusEl = null;
              if (evt.rewritten) {
                botDiv.insertAdjacentHTML("beforeend", `<div class="rewrite-badge">Corrige automatiquement</div>`);
              }
              break;
            }
            case "conversation":
              if (evt.id && !currentConversationId) {
                currentConversationId = evt.id;
                localStorage.setItem("conv_" + currentPersonaId, evt.id);
                loadConversations(currentPersonaId);
              }
              break;
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

  } catch {
    if (!botDiv.querySelector("button")) botDiv.textContent = "Connexion perdue. Reessayez.";
  }
  sending = false; $("chat-send").disabled = false; input.focus();
}

async function loadConversations(personaId) {
  try {
    const resp = await fetch(`/api/conversations?persona=${personaId}`, {
      headers: authHeaders(),
    });
    if (!resp.ok) return;
    const data = await resp.json();
    renderConversationList(data.conversations);
  } catch {}
}

function renderConversationList(conversations) {
  const list = $("conv-list");
  list.innerHTML = "";
  for (const conv of conversations) {
    const item = document.createElement("div");
    item.className = "conv-item" + (conv.id === currentConversationId ? " active" : "");
    const titleDiv = document.createElement("div");
    titleDiv.className = "conv-item-title";
    titleDiv.textContent = conv.title || "Sans titre";
    titleDiv.dataset.convId = conv.id;
    titleDiv.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      startTitleEdit(titleDiv, conv.id);
    });
    const metaDiv = document.createElement("div");
    metaDiv.className = "conv-item-meta";
    metaDiv.textContent = getRelativeTime(conv.last_message_at) + " \u00b7 " + (conv.message_count || 0) + " msg";
    item.appendChild(titleDiv);
    item.appendChild(metaDiv);
    item.addEventListener("click", () => loadConversation(conv.id));
    list.appendChild(item);
  }
}

function startTitleEdit(titleDiv, convId) {
  const original = titleDiv.textContent;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "conv-title-edit";
  input.value = original;
  input.maxLength = 100;
  titleDiv.replaceWith(input);
  input.focus();
  input.select();

  async function save() {
    const val = input.value.trim();
    if (!val || val === original) {
      const restored = document.createElement("div");
      restored.className = "conv-item-title";
      restored.textContent = original;
      restored.dataset.convId = convId;
      restored.addEventListener("dblclick", () => startTitleEdit(restored, convId));
      input.replaceWith(restored);
      return;
    }
    const newTitle = document.createElement("div");
    newTitle.className = "conv-item-title";
    newTitle.textContent = val;
    newTitle.dataset.convId = convId;
    newTitle.addEventListener("dblclick", () => startTitleEdit(newTitle, convId));
    input.replaceWith(newTitle);

    try {
      const resp = await fetch("/api/conversations?id=" + convId, {
        method: "PATCH",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ title: val }),
      });
      if (!resp.ok) {
        newTitle.textContent = original;
        showToast("Erreur de renommage");
      }
    } catch {
      newTitle.textContent = original;
      showToast("Erreur de renommage");
    }
  }

  input.addEventListener("blur", save);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); input.blur(); }
    if (e.key === "Escape") { input.value = original; input.blur(); }
  });
}

function getRelativeTime(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return "il y a " + mins + "m";
  const hours = Math.floor(mins / 60);
  if (hours < 24) return "il y a " + hours + "h";
  const days = Math.floor(hours / 24);
  return "il y a " + days + "j";
}

async function loadConversation(convId) {
  currentConversationId = convId;
  localStorage.setItem("conv_" + currentPersonaId, convId);

  try {
    const resp = await fetch("/api/conversations?id=" + convId, {
      headers: authHeaders(),
    });
    if (!resp.ok) return;
    const data = await resp.json();

    $("chat-messages").innerHTML = "";
    const sc = config.scenarios[currentScenario];
    addMessage("bot", sc?.welcome || "Bonjour, je suis " + config.name + ".");

    for (const msg of data.messages) {
      addMessage(msg.role === "user" ? "user" : "bot", msg.content);
    }

    loadConversations(currentPersonaId);
  } catch {}
}

function resumeConversation(conv) {
  currentConversationId = conv.id;
  const messages = conv.messages || [];
  // Re-render all messages
  $("chat-messages").innerHTML = "";
  const sc = config.scenarios[conv.scenario || "default"];
  addMessage("bot", sc?.welcome || `Bonjour, je suis ${config.name}.`);
  for (const msg of messages) {
    addMessage(msg.role === "user" ? "user" : "bot", msg.content);
  }
}

// Conversation sidebar
$("conv-new-btn").addEventListener("click", () => {
  currentConversationId = null;
  localStorage.removeItem("conv_" + currentPersonaId);
  $("chat-messages").innerHTML = "";
  const sc = config.scenarios[currentScenario];
  addMessage("bot", sc?.welcome || "Bonjour, je suis " + config.name + ".");
  $("chat-input").focus();
  document.querySelectorAll(".conv-item").forEach(el => el.classList.remove("active"));
});

let searchTimeout;
$("conv-search").addEventListener("input", (e) => {
  clearTimeout(searchTimeout);
  const query = e.target.value.trim();
  if (query.length < 2) { loadConversations(currentPersonaId); return; }
  searchTimeout = setTimeout(async () => {
    try {
      const resp = await fetch("/api/conversations?search=" + encodeURIComponent(query) + "&persona=" + currentPersonaId, {
        headers: authHeaders(),
      });
      if (!resp.ok) return;
      const data = await resp.json();
      const list = $("conv-list");
      list.innerHTML = "";
      for (const r of data.results) {
        const item = document.createElement("div");
        item.className = "conv-item";
        const titleDiv = document.createElement("div");
        titleDiv.className = "conv-item-title";
        titleDiv.textContent = r.conversation_title || "Sans titre";
        const metaDiv = document.createElement("div");
        metaDiv.className = "conv-item-meta";
        metaDiv.textContent = r.message_content_snippet.slice(0, 80) + "...";
        item.appendChild(titleDiv);
        item.appendChild(metaDiv);
        item.addEventListener("click", () => loadConversation(r.conversation_id));
        list.appendChild(item);
      }
    } catch {}
  }, 300);
});

// Back to scenarios
$("back-btn").addEventListener("click", () => {
  currentConversationId = null;
  currentScenario = "";
  $("chat-messages").innerHTML = "";
  setupScenarios();
  const keys = Object.keys(config.scenarios);
  if (keys.length === 1) {
    selectPersona(currentPersonaId);
  } else {
    showScreen("screen-scenarios");
  }
});

// Switch clone
$("conv-switch-btn").addEventListener("click", () => {
  currentConversationId = null;
  currentScenario = "";
  currentPersonaId = "";
  $("chat-messages").innerHTML = "";
  showScreen("screen-access");
  const personaList = $("persona-list");
  if (personaList && !personaList.classList.contains("hidden")) {
    // Already visible
  } else {
    doAccess();
  }
});

// Lead scraping
$("lead-btn").addEventListener("click", () => {
  $("lead-overlay").style.display = "flex";
  $("lead-url").value = "";
  $("lead-status").classList.add("hidden");
  $("lead-status").style.color = "";
  $("lead-submit").disabled = false;
  $("lead-submit").textContent = "Analyser";
  setTimeout(() => $("lead-url").focus(), 100);
});

$("lead-cancel").addEventListener("click", () => { $("lead-overlay").style.display = "none"; });
$("lead-overlay").addEventListener("click", (e) => { if (e.target === $("lead-overlay")) $("lead-overlay").style.display = "none"; });

$("lead-submit").addEventListener("click", async () => {
  const url = $("lead-url").value.trim();
  if (!url) return;

  if (!url.match(/linkedin\.com\/in\/[^/?#]+/)) {
    $("lead-status").textContent = "URL invalide. Format : linkedin.com/in/username";
    $("lead-status").classList.remove("hidden");
    $("lead-status").style.color = "";
    return;
  }

  const btn = $("lead-submit");
  const status = $("lead-status");
  btn.disabled = true;
  btn.textContent = "Analyse en cours...";
  status.textContent = "Recuperation du profil et des posts...";
  status.classList.remove("hidden");
  status.style.color = "";

  try {
    const resp = await fetch("/api/scrape", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ linkedin_url: url }),
    });

    if (resp.status === 501) {
      status.textContent = "Analyse non disponible (scraping non configure)";
      btn.disabled = false; btn.textContent = "Analyser";
      return;
    }
    if (!resp.ok) {
      const err = await resp.json();
      status.textContent = err.error || "Erreur d'analyse";
      btn.disabled = false; btn.textContent = "Analyser";
      return;
    }

    const data = await resp.json();
    const profile = data.profile;

    const posts = data.posts.slice(0, 3);
    let postSection = "";
    if (posts.length > 0) {
      const freq = data.postCount >= 10 ? "actif (10+ posts)" :
                   data.postCount >= 5 ? "regulier (5-10 posts)" :
                   data.postCount >= 2 ? "occasionnel (2-4 posts)" : "rare (1 post)";
      postSection = "SUJETS DU MOMENT (priorite pour l'opening) :\n" +
        "Frequence de publication : " + freq + "\n" +
        "3 derniers posts :\n" +
        posts.map((p, i) => (i + 1) + ". " + p.slice(0, 250)).join("\n\n");
    }

    const leadMsg = [
      "[Contexte lead \u2014 " + profile.name + "]",
      postSection,
      "PROFIL :\nTitre: " + profile.headline + "\n" + profile.text.slice(0, 500),
      "Aide-moi a preparer une approche personnalisee pour ce prospect. Utilise ses sujets recents comme angle d'ouverture.",
    ].filter(Boolean).join("\n\n");

    $("lead-overlay").style.display = "none";
    $("chat-input").value = leadMsg;
    sendMessage();

  } catch {
    status.textContent = "Erreur de connexion";
    btn.disabled = false;
    btn.textContent = "Analyser";
  }
});
