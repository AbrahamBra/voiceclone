-- Session tokens with expiration
CREATE TABLE IF NOT EXISTS public.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_token ON public.sessions(token);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON public.sessions(expires_at);

-- Cleanup expired sessions (run periodically or on read)
CREATE OR REPLACE FUNCTION cleanup_expired_sessions()
RETURNS void LANGUAGE SQL AS $$
  DELETE FROM sessions WHERE expires_at < now();
$$;
