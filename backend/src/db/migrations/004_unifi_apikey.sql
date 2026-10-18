-- Controladoras UniFi também por API key (Integration API oficial).
ALTER TABLE unifi_controllers
  ADD COLUMN auth_type TEXT NOT NULL DEFAULT 'password' CHECK (auth_type IN ('password', 'apikey'));
ALTER TABLE unifi_controllers ALTER COLUMN username DROP NOT NULL;
-- password_enc guarda a senha (auth_type = password) ou a API key (auth_type = apikey), sempre cifrada.
