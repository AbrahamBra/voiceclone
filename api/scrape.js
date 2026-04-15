import { authenticateRequest, setCors } from "../lib/supabase.js";

const LINKDAPI_KEY = process.env.LINKDAPI_KEY;
const LINKDAPI_BASE = "https://linkdapi.com/api/v1";

/**
 * Extract LinkedIn username from a URL.
 * Handles: linkedin.com/in/username, linkedin.com/in/username/, with query params
 */
function extractUsername(input) {
  const trimmed = input.trim();
  // Direct username (no URL)
  if (!trimmed.includes("/") && !trimmed.includes(".")) return trimmed;
  // URL parsing
  const match = trimmed.match(/linkedin\.com\/in\/([^/?#]+)/);
  return match ? match[1] : null;
}

export default async function handler(req, res) {
  setCors(res, "POST, OPTIONS");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  try {
    await authenticateRequest(req);
  } catch (err) {
    res.status(err.status || 403).json({ error: err.error || "Auth failed" });
    return;
  }

  if (!LINKDAPI_KEY) {
    res.status(501).json({ error: "Scraping non configure (LINKDAPI_KEY manquante)" });
    return;
  }

  const { linkedin_url } = req.body || {};
  if (!linkedin_url) {
    res.status(400).json({ error: "linkedin_url required" });
    return;
  }

  const username = extractUsername(linkedin_url);
  if (!username) {
    res.status(400).json({ error: "URL LinkedIn invalide. Format attendu : linkedin.com/in/username" });
    return;
  }

  const headers = { "X-linkdapi-apikey": LINKDAPI_KEY };

  try {
    // Step 1: Fetch full profile
    const profileResp = await fetch(`${LINKDAPI_BASE}/profile/full?username=${username}`, { headers });
    if (!profileResp.ok) throw new Error(`Profile fetch failed: ${profileResp.status}`);
    const profileData = await profileResp.json();
    const profile = profileData.data || profileData;

    // Extract URN for posts
    const urn = profile.urn || profile.entityUrn || profile.profileUrn;

    // Build profile text
    // Build profile text from available fields
    const positions = profile.fullPositions || profile.currentPositions || profile.experience || [];
    const profileText = [
      profile.firstName && profile.lastName ? `${profile.firstName} ${profile.lastName}` : "",
      profile.headline || "",
      profile.summary || profile.about || "",
      ...positions.map(e =>
        `${e.title || ""} chez ${e.companyName || e.company?.name || ""}: ${e.description || ""}`
      ),
    ].filter(Boolean).join("\n\n");

    // Step 2: Fetch posts (if URN available)
    let posts = [];
    if (urn) {
      try {
        const postsResp = await fetch(`${LINKDAPI_BASE}/posts/all?urn=${encodeURIComponent(urn)}`, { headers });
        if (postsResp.ok) {
          const postsData = await postsResp.json();
          // LinkdAPI returns { data: { posts: [...], cursor: "..." } }
          const rawPosts = postsData.data?.posts || postsData.data || postsData.posts || postsData || [];
          posts = (Array.isArray(rawPosts) ? rawPosts : [])
            .filter(p => p.text || p.commentary || p.content)
            .slice(0, 50)
            .map(p => p.text || p.commentary || p.content || "");
        }
      } catch {
        // Posts fetch failed — continue with profile only
      }
    }

    res.json({
      ok: true,
      profile: {
        name: [profile.firstName, profile.lastName].filter(Boolean).join(" "),
        headline: profile.headline || "",
        text: profileText,
      },
      posts,
      postCount: posts.length,
    });
  } catch (err) {
    console.log(JSON.stringify({ event: "scrape_error", username, error: err.message }));
    res.status(500).json({ error: "Erreur de scraping: " + err.message });
  }
}
