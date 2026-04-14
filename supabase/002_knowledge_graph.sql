-- Migration: Add knowledge graph tables (entities + relations)
-- Run this in Supabase SQL Editor

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

CREATE INDEX IF NOT EXISTS idx_entities_persona_id ON knowledge_entities(persona_id);
CREATE INDEX IF NOT EXISTS idx_relations_persona_id ON knowledge_relations(persona_id);
CREATE INDEX IF NOT EXISTS idx_relations_from ON knowledge_relations(from_entity_id);
CREATE INDEX IF NOT EXISTS idx_relations_to ON knowledge_relations(to_entity_id);
