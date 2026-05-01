// ============================================================
// LinkedIn scrape core (PR-1 V3.6.5).
//
// Pulled out of api/scrape.js so /api/v2/draft can call it inline for
// auto-scrape ("if prospect_data.linkedin_url is provided and no scrape
// data was passed, fetch the profile before drafting"). The HTTP
// endpoint api/scrape.js still exists for the wizard's manual flow.
// ============================================================

const LINKDAPI_KEY = process.env.LINKDAPI_KEY;
const LINKDAPI_BASE = "https://linkdapi.com/api/v1";

/** Strip lone surrogates that break JSON serialization. */
function sanitizeText(str) {
  if (typeof str !== "string") return str;
  return str.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
}

/** Extract `username` from a linkedin.com/in/<slug> URL or a bare slug. */
export function extractLinkedInUsername(input) {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  // URL form first — handles linkedin.com/in/<slug> with optional protocol/www.
  const match = trimmed.match(/linkedin\.com\/in\/([^/?#]+)/);
  if (match) return match[1];
  // Bare slug — alnum, hyphens, underscores only. Reject anything else
  // (URLs from other domains, free text with spaces, garbage).
  if (/^[A-Za-z0-9_-]+$/.test(trimmed)) return trimmed;
  return null;
}

/**
 * Scrape a LinkedIn profile + recent posts via LinkdAPI.
 *
 * Returns null on any failure (LINKDAPI_KEY missing, network blip, profile
 * not found). Caller decides whether to abort or proceed without scrape
 * data — /api/v2/draft proceeds with whatever prospect_context the operator
 * already passed (degraded but not broken).
 */
export async function scrapeLinkedInProfile(linkedinUrl, { timeoutMs = 8000 } = {}) {
  if (!LINKDAPI_KEY) return null;
  const username = extractLinkedInUsername(linkedinUrl);
  if (!username) return null;

  const headers = { "X-linkdapi-apikey": LINKDAPI_KEY };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const profileResp = await fetch(
      `${LINKDAPI_BASE}/profile/full?username=${username}`,
      { headers, signal: ctrl.signal },
    );
    if (!profileResp.ok) return null;
    const profileData = await profileResp.json();
    const profile = profileData.data || profileData;
    const urn = profile.urn || profile.entityUrn || profile.profileUrn;

    const positions = profile.fullPositions || profile.currentPositions || profile.experience || [];
    const profileText = [
      profile.firstName && profile.lastName ? `${profile.firstName} ${profile.lastName}` : "",
      profile.headline || "",
      profile.summary || profile.about || "",
      ...positions.map((e) =>
        `${e.title || ""} chez ${e.companyName || e.company?.name || ""}: ${e.description || ""}`,
      ),
    ].filter(Boolean).join("\n\n");

    let posts = [];
    if (urn) {
      try {
        const postsResp = await fetch(
          `${LINKDAPI_BASE}/posts/all?urn=${encodeURIComponent(urn)}`,
          { headers, signal: ctrl.signal },
        );
        if (postsResp.ok) {
          const postsData = await postsResp.json();
          const rawPosts = postsData.data?.posts || postsData.data || postsData.posts || postsData || [];
          posts = (Array.isArray(rawPosts) ? rawPosts : [])
            .filter((p) => p.text || p.commentary || p.content)
            .slice(0, 15)
            .map((p) => p.text || p.commentary || p.content || "");
        }
      } catch {
        // Posts fetch failed — fall through with profile-only.
      }
    }

    return {
      profile: {
        name: sanitizeText([profile.firstName, profile.lastName].filter(Boolean).join(" ")),
        headline: sanitizeText(profile.headline || ""),
        text: sanitizeText(profileText),
      },
      posts: posts.map(sanitizeText),
      postCount: posts.length,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Render scrape data as a [Contexte lead] block — same shape as the wizard's
 * Auto-remplir flow, so the LLM sees identical input regardless of which
 * surface fed it. The /draft handler prepends this to prospect_context.
 */
export function formatScrapeAsContextBlock(scrape) {
  if (!scrape || !scrape.profile) return "";
  const name = scrape.profile.name || "";
  const headline = scrape.profile.headline || "";
  const profileText = scrape.profile.text || "";
  const posts = Array.isArray(scrape.posts) ? scrape.posts.slice(0, 5) : [];

  const lines = [];
  lines.push(`[Contexte lead — ${name}]`);
  if (headline) lines.push(`Headline : ${headline}`);
  if (profileText) lines.push("");
  if (profileText) lines.push(profileText);
  if (posts.length > 0) {
    lines.push("");
    lines.push("Posts récents :");
    for (const p of posts) {
      const snippet = p.length > 400 ? p.slice(0, 400) + "…" : p;
      lines.push(`- ${snippet}`);
    }
  }
  return lines.join("\n");
}
