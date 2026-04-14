-- VoiceClone SaaS Schema
-- Run this in Supabase SQL Editor

-- 1. Clients (auth + billing)
CREATE TABLE IF NOT EXISTS clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  access_code text UNIQUE NOT NULL,
  name text NOT NULL,
  tier text DEFAULT 'free' CHECK (tier IN ('free', 'premium')),
  max_clones int DEFAULT 1,
  budget_cents int DEFAULT 200,
  spent_cents int DEFAULT 0,
  anthropic_api_key text,
  scraping_api_key text,
  created_at timestamptz DEFAULT now(),
  is_active boolean DEFAULT true
);

-- 2. Personas
CREATE TABLE IF NOT EXISTS personas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL,
  client_id uuid REFERENCES clients(id) ON DELETE CASCADE,
  name text NOT NULL,
  title text,
  avatar text,
  description text,
  voice jsonb NOT NULL,
  scenarios jsonb NOT NULL,
  theme jsonb,
  created_at timestamptz DEFAULT now(),
  is_active boolean DEFAULT true,
  UNIQUE(client_id, slug)
);

-- 3. Knowledge files
CREATE TABLE IF NOT EXISTS knowledge_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id uuid REFERENCES personas(id) ON DELETE CASCADE NOT NULL,
  path text NOT NULL,
  keywords text[] DEFAULT '{}',
  content text NOT NULL,
  source_type text DEFAULT 'auto' CHECK (source_type IN ('auto', 'manual', 'document')),
  created_at timestamptz DEFAULT now(),
  UNIQUE(persona_id, path)
);

-- 4. Scenario files
CREATE TABLE IF NOT EXISTS scenario_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id uuid REFERENCES personas(id) ON DELETE CASCADE NOT NULL,
  slug text NOT NULL,
  content text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(persona_id, slug)
);

-- 5. Corrections (feedback loop)
CREATE TABLE IF NOT EXISTS corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id uuid REFERENCES personas(id) ON DELETE CASCADE NOT NULL,
  correction text NOT NULL,
  user_message text,
  bot_message text,
  created_at timestamptz DEFAULT now()
);

-- 6. Usage log
CREATE TABLE IF NOT EXISTS usage_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES clients(id) NOT NULL,
  persona_id uuid REFERENCES personas(id),
  input_tokens int NOT NULL DEFAULT 0,
  output_tokens int NOT NULL DEFAULT 0,
  cost_cents numeric(10,4) NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- 7. Knowledge entities (ontology)
CREATE TABLE IF NOT EXISTS knowledge_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id uuid REFERENCES personas(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('concept', 'framework', 'person', 'company', 'metric', 'belief', 'tool')),
  description text,
  confidence numeric(3,2) DEFAULT 1.0,
  created_at timestamptz DEFAULT now(),
  UNIQUE(persona_id, name)
);

-- 8. Knowledge relations (graph edges)
CREATE TABLE IF NOT EXISTS knowledge_relations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id uuid REFERENCES personas(id) ON DELETE CASCADE NOT NULL,
  from_entity_id uuid REFERENCES knowledge_entities(id) ON DELETE CASCADE NOT NULL,
  to_entity_id uuid REFERENCES knowledge_entities(id) ON DELETE CASCADE NOT NULL,
  relation_type text NOT NULL CHECK (relation_type IN ('equals', 'includes', 'contradicts', 'causes', 'uses', 'prerequisite')),
  description text,
  confidence numeric(3,2) DEFAULT 1.0,
  created_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_clients_access_code ON clients(access_code) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_personas_client_id ON personas(client_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_persona_id ON knowledge_files(persona_id);
CREATE INDEX IF NOT EXISTS idx_corrections_persona_id ON corrections(persona_id);
CREATE INDEX IF NOT EXISTS idx_usage_client_id ON usage_log(client_id);
CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_log(created_at);
CREATE INDEX IF NOT EXISTS idx_entities_persona_id ON knowledge_entities(persona_id);
CREATE INDEX IF NOT EXISTS idx_relations_persona_id ON knowledge_relations(persona_id);
CREATE INDEX IF NOT EXISTS idx_relations_from ON knowledge_relations(from_entity_id);
CREATE INDEX IF NOT EXISTS idx_relations_to ON knowledge_relations(to_entity_id);
