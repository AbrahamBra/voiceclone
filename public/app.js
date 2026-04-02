// ============================================================
// AHMET AKYUREK CLONE — Client-side Application
// ============================================================

let accessCode = "";
let currentScenario = "";
let conversationHistory = [];
let isStreaming = false;

// DOM elements
const screenAccess = document.getElementById("screen-access");
const screenScenario = document.getElementById("screen-scenario");
const screenChat = document.getElementById("screen-chat");
const accessInput = document.getElementById("access-code");
const accessError = document.getElementById("access-error");
const btnAccess = document.getElementById("btn-access");
const chatMessages = document.getElementById("chat-messages");
const chatInput = document.getElementById("chat-input");
const btnSend = document.getElementById("btn-send");
const btnBack = document.getElementById("btn-back");

// ============================================================
// NAVIGATION
// ============================================================

function showScreen(screen) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  screen.classList.add("active");
}

// ============================================================
// SCREEN 1 — Access
// ============================================================

btnAccess.addEventListener("click", handleAccess);
accessInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleAccess();
});

async function handleAccess() {
  const code = accessInput.value.trim();
  if (!code) {
    accessError.textContent = "Entre un code d'acces.";
    return;
  }

  accessError.textContent = "";
  btnAccess.textContent = "...";
  btnAccess.disabled = true;

  try {
    const res = await fetch("/api/chat?code=" + encodeURIComponent(code), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scenario: "free",
        messages: [{ role: "user", content: "test" }],
      }),
    });

    if (res.status === 403) {
      accessError.textContent = "Code invalide.";
    } else {
      accessCode = code;
      showScreen(screenScenario);
    }
  } catch (err) {
    accessError.textContent = "Erreur de connexion.";
  }

  btnAccess.textContent = "Entrer";
  btnAccess.disabled = false;
}

// ============================================================
// SCREEN 2 — Scenario
// ============================================================

document.querySelectorAll(".scenario-card").forEach((card) => {
  card.addEventListener("click", () => {
    currentScenario = card.dataset.scenario;
    conversationHistory = [];
    chatMessages.innerHTML = "";
    showScreen(screenChat);

    if (currentScenario === "analyze") {
      chatInput.placeholder = "Colle le texte du profil LinkedIn ici...";
      chatInput.rows = 4;
    } else {
      chatInput.placeholder = "Ecris ton message...";
      chatInput.rows = 1;
    }

    chatInput.focus();
  });
});

// ============================================================
// SCREEN 3 — Chat
// ============================================================

btnBack.addEventListener("click", () => {
  showScreen(screenScenario);
});

btnSend.addEventListener("click", sendMessage);
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Auto-resize textarea
chatInput.addEventListener("input", () => {
  chatInput.style.height = "auto";
  chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + "px";
});

function addMessage(role, text) {
  const div = document.createElement("div");
  div.className = "msg " + (role === "user" ? "msg-user" : "msg-bot");
  div.textContent = text;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return div;
}

function createBotBubble() {
  const div = document.createElement("div");
  div.className = "msg msg-bot streaming";
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return div;
}

function formatAnalysisResponse(container) {
  const text = container.textContent;

  // Parse analysis, dm, and transition blocks
  const analysisMatch = text.match(/<analysis>([\s\S]*?)<\/analysis>/);
  const dmMatch = text.match(/<dm>([\s\S]*?)<\/dm>/);
  const transitionMatch = text.match(/<transition>([\s\S]*?)<\/transition>/);

  if (analysisMatch || dmMatch || transitionMatch) {
    let html = "";

    if (analysisMatch) {
      html += '<div class="analysis-block">' + escapeHtml(analysisMatch[1].trim()) + "</div>";
    }

    if (dmMatch) {
      html += '<div class="dm-block">' + escapeHtml(dmMatch[1].trim()) + "</div>";
    }

    if (transitionMatch) {
      html += '<div class="transition-block">' + escapeHtml(transitionMatch[1].trim()) + "</div>";
    }

    // Any text outside the tags
    let remaining = text;
    if (analysisMatch) remaining = remaining.replace(analysisMatch[0], "");
    if (dmMatch) remaining = remaining.replace(dmMatch[0], "");
    if (transitionMatch) remaining = remaining.replace(transitionMatch[0], "");
    remaining = remaining.trim();

    if (remaining) {
      html = escapeHtml(remaining) + html;
    }

    container.innerHTML = html;
  }
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, "<br>");
}

async function sendMessage() {
  const text = chatInput.value.trim();
  if (!text || isStreaming) return;

  addMessage("user", text);
  chatInput.value = "";
  chatInput.style.height = "auto";

  const isFirstAnalyze =
    currentScenario === "analyze" && conversationHistory.length === 0;

  conversationHistory.push({ role: "user", content: text });

  isStreaming = true;
  btnSend.disabled = true;

  const bubble = createBotBubble();
  let fullText = "";

  try {
    const body = {
      scenario: currentScenario === "analyze" ? "analyze" : "free",
      messages: conversationHistory,
    };

    if (isFirstAnalyze) {
      body.profileText = text;
    }

    const res = await fetch("/api/chat?code=" + encodeURIComponent(accessCode), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      bubble.textContent = "Erreur : " + res.status;
      bubble.classList.remove("streaming");
      isStreaming = false;
      btnSend.disabled = false;
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
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
          const data = JSON.parse(line.slice(6));
          if (data.type === "delta") {
            fullText += data.text;
            bubble.textContent = fullText;
            chatMessages.scrollTop = chatMessages.scrollHeight;
          } else if (data.type === "done") {
            break;
          } else if (data.type === "error") {
            fullText += "\n[Erreur]";
            bubble.textContent = fullText;
          }
        } catch (e) {
          // skip malformed JSON
        }
      }
    }
  } catch (err) {
    fullText = "Erreur de connexion.";
    bubble.textContent = fullText;
  }

  bubble.classList.remove("streaming");

  // Format analysis blocks if analyze scenario
  if (currentScenario === "analyze") {
    formatAnalysisResponse(bubble);
  }

  conversationHistory.push({ role: "assistant", content: fullText });
  isStreaming = false;
  btnSend.disabled = false;
  chatInput.focus();
}
