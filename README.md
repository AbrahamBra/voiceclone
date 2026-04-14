# VoiceClone — White-Label Text Clone Framework

Create an AI-powered text clone that reproduces someone's writing voice, tone, and domain expertise.

## Quick Start

1. Clone this repo
2. Copy `persona/persona.json` and customize for your persona
3. Add knowledge files in `persona/knowledge/` with YAML frontmatter keywords
4. Set environment variables:
   - `ACCESS_CODE` — password for the app
   - `ANTHROPIC_API_KEY` — your Anthropic API key
5. Deploy to Vercel: `vercel --prod`

## How It Works

1. **persona.json** defines identity, voice rules (tone, forbidden words, writing rules), scenarios, and theme
2. **Knowledge base** (markdown files with keyword frontmatter) provides domain expertise
3. **3-pass pipeline**: generate response → critic check against rules → rewrite if violations found
4. **Frontend** adapts automatically: name, avatar, colors, scenarios all from config

## Project Structure

- `persona/` — All persona configuration (persona.json + knowledge + scenarios)
- `api/` — Vercel serverless endpoints (chat, config, health)
- `lib/` — Core logic (pipeline, prompt builder, knowledge loader)
- `public/` — Frontend SPA
- `eval/` — Test suite

## Customization

Edit `persona/persona.json` to change:
- `name`, `title`, `avatar`, `description` — identity
- `voice.tone`, `voice.personality` — character traits
- `voice.forbiddenWords` — words the clone must never use
- `voice.writingRules` — writing style constraints
- `voice.signaturePhrases` — characteristic expressions
- `scenarios` — available chat modes
- `theme` — UI colors (accent, background, surface, text)

## Adding Knowledge

Create `.md` files in `persona/knowledge/` with YAML frontmatter:

    ---
    keywords: ["topic", "related", "terms"]
    ---
    # Your content here

The system automatically detects relevant knowledge based on user message keywords.
