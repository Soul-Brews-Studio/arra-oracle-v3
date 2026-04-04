/**
 * OAuth 2.1 types for Oracle v3
 *
 * Used by the OAuthProvider and Hono route handlers.
 * Persisted to ORACLE_DATA_DIR/.oauth-state.json
 */

export interface OAuthTokenData {
  client_id: string;
  scopes: string[];
  expires_at: number;
  resource?: string;
}

export interface OAuthState {
  clients: Record<string, OAuthClientInfo>;
  tokens: Record<string, OAuthTokenData>;
}

export interface OAuthClientInfo {
  client_id: string;
  client_secret?: string;
  redirect_uris: string[];
  client_name?: string;
  grant_types?: string[];
  response_types?: string[];
  scope?: string;
  token_endpoint_auth_method?: string;
}

export interface PendingAuthorization {
  client_id: string;
  state?: string;
  scopes: string[];
  code_challenge: string;
  redirect_uri: string;
  resource?: string;
  created_at: number;
}
