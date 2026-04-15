-- Add style_rule type to knowledge_entities and enforces relation type
-- Run in Supabase SQL Editor

ALTER TABLE knowledge_entities DROP CONSTRAINT IF EXISTS knowledge_entities_type_check;
ALTER TABLE knowledge_entities ADD CONSTRAINT knowledge_entities_type_check
  CHECK (type IN ('concept', 'framework', 'person', 'company', 'metric', 'belief', 'tool', 'style_rule'));

ALTER TABLE knowledge_relations DROP CONSTRAINT IF EXISTS knowledge_relations_relation_type_check;
ALTER TABLE knowledge_relations ADD CONSTRAINT knowledge_relations_relation_type_check
  CHECK (relation_type IN ('equals', 'includes', 'contradicts', 'causes', 'uses', 'prerequisite', 'enforces'));
