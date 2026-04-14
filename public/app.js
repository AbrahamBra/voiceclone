let config = null;
let accessCode = "";
let currentScenario = "";
let history = [];

const $ = (id) => document.getElementById(id);

function renderMarkdown(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/^---$/gm, "<hr>")
    .replace(/^[-•] (.+)$/gm, "<li>$1</li>")
    .replace(/^(\d+)[.)]\s+(.+)$/gm, "<li>$2</li>")
    .replace(/((?:<li>.*<\/li>\n?)+)/g, "<ul>$1</ul>")
    .replace(/▶/g, "&#9654;")
    .replace(/→/g, "&#8594;")
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

// Access screen
$("access-btn").addEventListener("click", doAccess);
$("access-code").addEventListener("keydown", (e) => { if (e.key === "Enter") doAccess(); });

async function doAccess() {
  const code = $("access-code").value.trim();
  if (!code) return;

  const errorEl = $("access-error");
  errorEl.classList.add("hidden");

  try {
    const resp = await fetch("/api/config", { headers: { "x-access-code": code } });
    if (resp.status === 403) {
      errorEl.textContent = "Code d'acces invalide";
      errorEl.classList.remove("hidden");
      $("access-code").classList.add("shake");
      setTimeout(() => $("access-code").classList.remove("shake"), 400);
      return;
    }
    if (!resp.ok) throw new Error("Server error");

    config = await resp.json();
    accessCode = code;
    document.title = `${config.name} — Clone IA`;
    applyTheme(config.theme);
    setupScenarios();

    const keys = Object.keys(config.scenarios);
    if (keys.length === 1) { startChat(keys[0]); }
    else { showScreen("screen-scenarios"); }
  } catch {
    errorEl.textContent = "Erreur de connexion";
    errorEl.classList.remove("hidden");
  }
}

// Scenarios screen
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

// Chat screen
function startChat(scenario) {
  currentScenario = scenario;
  history = [];
  $("chat-avatar").textContent = config.avatar;
  $("chat-name").textContent = config.name;
  $("chat-messages").innerHTML = "";
  const scenarioConfig = config.scenarios[scenario];
  const welcome = scenarioConfig?.welcome || `Bonjour, je suis ${config.name}. Comment puis-je vous aider ?`;
  addMessage("bot", welcome);
  showScreen("screen-chat");
  $("chat-input").focus();
}

function addMessage(role, text) {
  const container = $("chat-messages");
  const div = document.createElement("div");
  div.className = `msg msg-${role}`;
  if (role === "bot") {
    div.innerHTML = renderMarkdown(text);
    // Add feedback button for bot messages (not welcome)
    if (history.length > 0 || container.children.length > 1) {
      const feedbackBtn = document.createElement("button");
      feedbackBtn.className = "feedback-btn";
      feedbackBtn.textContent = "Corriger";
      feedbackBtn.addEventListener("click", () => openFeedback(div, text));
      div.appendChild(feedbackBtn);
    }
  } else {
    div.textContent = text;
  }
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
}

function openFeedback(msgDiv, botText) {
  // Get the last user message for context
  const lastUserMsg = history.length > 0 ? history[history.length - 1]?.content || "" : "";

  const overlay = document.createElement("div");
  overlay.className = "feedback-overlay";
  overlay.innerHTML = `
    <div class="feedback-modal">
      <h3>Corriger cette reponse</h3>
      <p class="feedback-hint">Qu'est-ce qui ne va pas ? Le clone apprendra de cette correction.</p>
      <textarea id="feedback-text" placeholder="Ex: Trop formel, utilise des tirets, pas assez direct..." rows="3"></textarea>
      <div class="feedback-actions">
        <button class="feedback-cancel">Annuler</button>
        <button class="feedback-submit">Envoyer</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector(".feedback-cancel").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelector(".feedback-submit").addEventListener("click", async () => {
    const correction = overlay.querySelector("#feedback-text").value.trim();
    if (!correction) return;

    const submitBtn = overlay.querySelector(".feedback-submit");
    submitBtn.disabled = true;
    submitBtn.textContent = "Envoi...";

    try {
      const resp = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-access-code": accessCode },
        body: JSON.stringify({ correction, botMessage: botText, userMessage: lastUserMsg }),
      });

      if (resp.ok) {
        showToast("Correction enregistree. Le clone s'ameliore ;)");
        overlay.remove();
      } else {
        showToast("Erreur lors de l'envoi");
        submitBtn.disabled = false;
        submitBtn.textContent = "Envoyer";
      }
    } catch {
      showToast("Erreur de connexion");
      submitBtn.disabled = false;
      submitBtn.textContent = "Envoyer";
    }
  });

  setTimeout(() => overlay.querySelector("#feedback-text").focus(), 100);
}

$("chat-send").addEventListener("click", sendMessage);
$("chat-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});
$("chat-input").addEventListener("input", function () {
  this.style.height = "auto";
  this.style.height = Math.min(this.scrollHeight, 120) + "px";
});

let sending = false;

async function sendMessage() {
  if (sending) return;
  const input = $("chat-input");
  const text = input.value.trim();
  if (!text) return;

  sending = true;
  input.value = "";
  input.style.height = "auto";
  $("chat-send").disabled = true;

  addMessage("user", text);
  const botDiv = addMessage("bot", "");
  botDiv.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';

  try {
    const resp = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-access-code": accessCode },
      body: JSON.stringify({ message: text, history, scenario: currentScenario }),
    });

    if (resp.status === 429) {
      showToast("Trop de messages, patientez un instant");
      botDiv.remove();
      sending = false;
      $("chat-send").disabled = false;
      return;
    }
    if (!resp.ok) throw new Error("Server error");

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let botText = "";
    let statusEl = null;
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();

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
              statusEl = document.createElement("div");
              statusEl.className = "status";
              statusEl.textContent = "Verification...";
              botDiv.appendChild(statusEl);
              break;
            case "rewriting":
              if (statusEl) statusEl.textContent = "Amelioration...";
              break;
            case "clear":
              botText = "";
              botDiv.innerHTML = "";
              if (statusEl) botDiv.appendChild(statusEl);
              break;
            case "done":
              if (statusEl) statusEl.remove();
              statusEl = null;
              break;
            case "error":
              botDiv.textContent = "Connexion perdue. ";
              const retryBtn = document.createElement("button");
              retryBtn.textContent = "Reessayer";
              retryBtn.style.cssText = "background:var(--accent);color:#fff;border:none;border-radius:6px;padding:4px 12px;cursor:pointer;font-size:0.85rem;";
              retryBtn.addEventListener("click", () => {
                botDiv.remove();
                $("chat-input").value = text;
                sendMessage();
              });
              botDiv.appendChild(retryBtn);
              break;
          }
        } catch { /* skip unparseable lines */ }
      }
      $("chat-messages").scrollTop = $("chat-messages").scrollHeight;
    }

    history.push({ role: "user", content: text });
    history.push({ role: "assistant", content: botText });
    if (history.length > 20) history = history.slice(history.length - 20);
  } catch {
    if (!botDiv.querySelector("button")) {
      botDiv.textContent = "Connexion perdue. Reessayez.";
    }
  }

  sending = false;
  $("chat-send").disabled = false;
  input.focus();
}

// Init placeholders
$("access-avatar").textContent = "?";
$("access-name").textContent = "Clone IA";
$("access-title").textContent = "Entrez votre code d'acces";
