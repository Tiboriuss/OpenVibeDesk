/** Public OAuth state. Tokens and authorization URLs never reach the renderer. */
export interface ChatGptProfile {
  id: string;
  label: string;
  authenticated: boolean;
  planAccess: boolean;
}

export interface ChatGptStatus {
  authenticated: boolean;
  loginPending: boolean;
  planAccess: boolean;
  accountLabel?: string;
  activeProfileId?: string;
  profiles: ChatGptProfile[];
  error?: string;
}

export interface ChatGptLoginOptions {
  profileId?: string;
  newProfile?: boolean;
  /** Explicit user action to grant previously declined ChatGPT plan usage. */
  consent?: boolean;
}
