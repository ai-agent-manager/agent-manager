// ---------------------------------------------------------------------------
// Types shared between popup, content script, and service worker.
// These mirror the agent-manager server's response shapes.
// ---------------------------------------------------------------------------

/**
 * Summary of a Rovo agent, returned by GET /agents.
 */
export interface AgentSummary {
  dirName: string;
  name: string;
  description: string;
  avatar: string | null;
  meta: AssetMeta | null;
}

export interface AssetMeta {
  name: string;
  description: string;
  tags?: string[];
}

/**
 * Full agent detail, returned by GET /agents/:dirName.
 */
export interface AgentDetail {
  dirName: string;
  config: RovoAgentConfig;
  meta: AssetMeta | null;
}

// ---------------------------------------------------------------------------
// Rovo agent config — mirrors scanner.ts types from agent-manager
// ---------------------------------------------------------------------------

export interface RovoAgentConfig {
  apiVersion: string;
  kind: string;
  identity: RovoAgentIdentity;
  scenarios: {
    default: RovoDefaultScenario;
    custom?: RovoCustomScenario[];
  };
  knowledgeSources?: RovoKnowledgeSource[];
}

export interface RovoAgentIdentity {
  name: string;
  description: string;
  avatar?: string;
  behavior: string;
  conversationStarters?: string[];
}

export interface RovoDefaultScenario {
  instructions: string;
  knowledge?: 'all' | 'custom' | 'none';
  webSearch?: boolean;
  skills?: string[];
}

export interface RovoCustomScenario extends RovoDefaultScenario {
  name: string;
  trigger: string;
  deepResearch?: boolean;
  enabled?: boolean;
}

export interface RovoKnowledgeSource {
  type: string;
  filter?: string;
}

// ---------------------------------------------------------------------------
// Messages between popup <-> content script
// ---------------------------------------------------------------------------

export interface ProvisionRequest {
  action: 'provision';
  config: RovoAgentConfig;
}

export interface ProvisionProgress {
  type: 'progress';
  step: number;
  total: number;
  message: string;
}

export interface ProvisionResult {
  success: boolean;
  error?: string;
}

export interface PingRequest {
  action: 'ping';
}

export interface PingResponse {
  ready: boolean;
}

export type ContentMessage = ProvisionRequest | PingRequest;
