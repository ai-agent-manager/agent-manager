import { mkdir, stat, unlink, chmod } from 'node:fs/promises';
import type { Provisioner, InstalledSkill, InstallResult, ProgressCallback, UninstallResult } from './types.js';
import type { SkillInfo, RovoAgentConfig, KnowledgeBaseFile } from '../bundle/scanner.js';
import { getAuthDir, getAtlassianAuthPath, AUTH_TTL_MS } from '../config/paths.js';
import type {
  KnowledgePage,
  KnowledgeBaseStrategy,
  ExistingKnowledgeBase,
} from '../services/confluence/types.js';
import type { CreateAgentResult } from '../services/studio/types.js';
import { ConfluenceService } from '../services/confluence/ConfluenceService.js';
import { PlaywrightConfluenceClient } from '../services/confluence/PlaywrightConfluenceClient.js';
import { StudioService } from '../services/studio/StudioService.js';
import { applyKbUrlSubstitutions } from '../services/studio/substitutions.js';

// Re-export types that consumers (e.g. RovoMenu) need
export type { KnowledgePage, KnowledgeBaseStrategy, ExistingKnowledgeBase };
export type { CreateAgentResult };

/**
 * Rovo Agent Provisioner — orchestrates Rovo agent creation by delegating to:
 *
 *  - {@link ConfluenceService} for knowledge-base page management
 *  - {@link StudioService} for Atlassian Studio UI automation
 *
 * This class owns browser lifecycle and auth state management. Business logic
 * lives in the service layer.
 *
 * Authentication is handled separately from provisioning:
 *
 *   1. authenticate(studioUrl) — opens a headed browser for the user to log in
 *      interactively (supports SSO, 2FA, WebAuthn, etc.). Saves browser auth
 *      state to ~/.agentman/auth/ with restrictive file permissions (0o600).
 *
 *   2. createAgent({ studioUrl, config, headless? }) — reuses saved auth state
 *      to automate agent creation. Can be called repeatedly without re-authenticating.
 *
 * Auth state expires after 24 hours by default (AUTH_TTL_MS).
 */
export class RovoProvisioner implements Provisioner {
  readonly id = 'rovo-agent';
  readonly name = 'Atlassian Rovo';
  readonly type = 'rovo-agent' as const;

  private onProgress?: ProgressCallback;

  constructor(options?: { onProgress?: ProgressCallback }) {
    this.onProgress = options?.onProgress;
  }

  private log(message: string, step?: number, total?: number) {
    this.onProgress?.(message, step, total);
  }

  async detect(): Promise<{ available: boolean; reason?: string }> {
    try {
      await import('playwright');
      return { available: true };
    } catch {
      return {
        available: false,
        reason: 'Playwright is not installed. Run: npm install playwright && npx playwright install chromium',
      };
    }
  }

  async getInstalled(): Promise<InstalledSkill[]> {
    // Rovo agents are provisioned remotely — we cannot inspect what's installed
    return [];
  }

  async install(_items: SkillInfo[], _bundleVersion: string): Promise<InstallResult> {
    // Use createAgent() directly instead
    return { installed: [], errors: [{ name: 'rovo', error: 'Use createAgent() for Rovo provisioning' }] };
  }

  async uninstall(_names: string[]): Promise<UninstallResult> {
    return {
      removed: [],
      errors: [{ name: 'rovo', error: 'Uninstall is not supported for Rovo agents' }],
    };
  }

  // ---------------------------------------------------------------------------
  // Auth state management
  // ---------------------------------------------------------------------------

  /**
   * Check whether a valid (non-expired) auth state file exists.
   */
  async hasValidAuth(): Promise<boolean> {
    try {
      const info = await stat(getAtlassianAuthPath());
      const age = Date.now() - info.mtimeMs;
      return age < AUTH_TTL_MS;
    } catch {
      return false;
    }
  }

  /**
   * Delete saved auth state.
   */
  async clearAuth(): Promise<void> {
    try {
      await unlink(getAtlassianAuthPath());
    } catch {
      // File may not exist — that's fine
    }
  }

  /**
   * Open a headed browser so the user can log in to Atlassian interactively.
   * On success, the browser's auth state (cookies + localStorage) is persisted
   * to disk for reuse by createAgent().
   */
  async authenticate(studioUrl: string): Promise<void> {
    const { chromium } = await import('playwright');

    this.log('Launching browser for authentication...', 1, 3);

    const browser = await chromium.launch({
      headless: false,
      slowMo: 100,
    });

    const context = await browser.newContext({
      viewport: { width: 1400, height: 900 },
    });
    context.setDefaultTimeout(120_000);
    context.setDefaultNavigationTimeout(120_000);

    const page = await context.newPage();

    try {
      await page.goto(studioUrl);
      this.log('Please log in via the browser window...', 2, 3);

      await page.waitForFunction(
        () => {
          const url = window.location.href;
          if (url.includes('/agents') || url.includes('/studio')) return true;
          return !!document.querySelector('[data-testid="create-agent-button-trigger"]');
        },
        { timeout: 300_000 } // 5 minute timeout for login
      );

      this.log('Login successful — saving auth state...', 3, 3);

      // Ensure auth directory exists with restrictive permissions
      const authDir = getAuthDir();
      await mkdir(authDir, { recursive: true, mode: 0o700 });
      await chmod(authDir, 0o700);

      // Save auth state
      const authPath = getAtlassianAuthPath();
      await context.storageState({ path: authPath });
      await chmod(authPath, 0o600);

      this.log('Auth state saved.');
    } finally {
      await browser.close();
    }
  }

  // ---------------------------------------------------------------------------
  // Agent creation — orchestrates ConfluenceService + StudioService
  // ---------------------------------------------------------------------------

  /**
   * Create a Rovo agent in Atlassian Studio via browser automation.
   * Requires a valid auth state from a prior authenticate() call.
   *
   * When `confluenceBaseUrl`, `confluenceSpaceKey`, and `knowledgeBaseFiles`
   * are supplied, knowledge-base `.md` files are uploaded to Confluence first,
   * and filename references in the agent config are replaced with Confluence
   * page URLs before the config is pasted into Studio.
   */
  async createAgent(options: {
    studioUrl: string;
    config: RovoAgentConfig;
    headless?: boolean;
    confluenceBaseUrl?: string;
    confluenceSpaceKey?: string;
    knowledgeBaseFiles?: KnowledgeBaseFile[];
    knowledgeBaseStrategy?: KnowledgeBaseStrategy;
    existingKnowledgeBase?: ExistingKnowledgeBase;
  }): Promise<CreateAgentResult> {
    const authPath = getAtlassianAuthPath();

    // Verify auth state exists and is fresh
    const hasAuth = await this.hasValidAuth();
    if (!hasAuth) {
      throw new Error(
        'No valid auth state found. Please authenticate first by selecting "Log in to Atlassian" from the Rovo menu.'
      );
    }

    const { chromium } = await import('playwright');
    const headless = options.headless ?? false;
    const { config } = options;

    const customScenarioCount = config.scenarios.custom?.length ?? 0;
    const hasKnowledgeBase =
      !!options.confluenceBaseUrl &&
      !!options.confluenceSpaceKey &&
      (options.knowledgeBaseFiles?.length ?? 0) > 0;

    // Steps: navigate(1) + create(2) + identity(3) + default scenario(4)
    //        + N custom scenarios + activate(last)
    // If uploading a knowledge base, add one step for that phase.
    const baseSteps = 5 + customScenarioCount;
    const totalSteps = hasKnowledgeBase ? baseSteps + 1 : baseSteps;

    this.log('Launching browser...', 1, totalSteps);
    const browser = await chromium.launch({
      headless,
      slowMo: headless ? 100 : 300,
    });

    let knowledgePages: KnowledgePage[] = [];

    const context = await browser.newContext({
      viewport: { width: 1400, height: 900 },
      storageState: authPath,
    });
    context.setDefaultTimeout(120_000);
    context.setDefaultNavigationTimeout(120_000);

    const page = await context.newPage();

    try {
      // Phase 0 (optional): Upload knowledge-base to Confluence
      if (hasKnowledgeBase) {
        knowledgePages = await this.handleKnowledgeBase(
          page, context, options, totalSteps,
        );
      }

      // Phase 1: Create the Rovo agent in Atlassian Studio
      const stepOffset = hasKnowledgeBase ? 1 : 0;
      const activeConfig = knowledgePages.length > 1
        ? applyKbUrlSubstitutions(config, knowledgePages.slice(1))
        : config;

      // Child pages to link as custom knowledge (excludes the parent folder page at index 0)
      const childPages = knowledgePages.length > 1 ? knowledgePages.slice(1) : [];

      const studio = new StudioService(page, this.onProgress);
      await studio.createAgent({
        studioUrl: options.studioUrl,
        config: activeConfig,
        knowledgePages: childPages,
        step: 1 + stepOffset,
        totalSteps,
      });

      // Keep browser open briefly for review when headed
      if (!headless) {
        await page.waitForTimeout(5000);
      }
    } finally {
      await browser.close();
    }

    return { knowledgePages };
  }

  /**
   * Check whether knowledge-base pages already exist in Confluence for the
   * given agent. Opens a headless browser, authenticates via saved state,
   * and queries the Confluence REST API.
   */
  async checkExistingKnowledgeBase(options: {
    confluenceBaseUrl: string;
    confluenceSpaceKey: string;
    agentName: string;
  }): Promise<ExistingKnowledgeBase | null> {
    const hasAuth = await this.hasValidAuth();
    if (!hasAuth) {
      throw new Error('No valid auth state. Please authenticate first.');
    }

    const { chromium } = await import('playwright');
    const authPath = getAtlassianAuthPath();

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1400, height: 900 },
      storageState: authPath,
    });
    context.setDefaultTimeout(120_000);
    context.setDefaultNavigationTimeout(120_000);
    const page = await context.newPage();

    try {
      const client = new PlaywrightConfluenceClient(page, context);
      const confluence = new ConfluenceService(client, this.onProgress);
      return await confluence.checkExistingKnowledgeBase(options);
    } finally {
      await browser.close();
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Handle the knowledge-base upload/reuse phase.
   */
  private async handleKnowledgeBase(
    page: import('playwright').Page,
    context: import('playwright').BrowserContext,
    options: {
      confluenceBaseUrl?: string;
      confluenceSpaceKey?: string;
      knowledgeBaseFiles?: KnowledgeBaseFile[];
      knowledgeBaseStrategy?: KnowledgeBaseStrategy;
      existingKnowledgeBase?: ExistingKnowledgeBase;
      config: RovoAgentConfig;
    },
    totalSteps: number,
  ): Promise<KnowledgePage[]> {
    if (options.knowledgeBaseStrategy === 'reuse' && options.existingKnowledgeBase) {
      // Reuse existing pages — no upload needed
      this.log('Reusing existing knowledge base pages from Confluence...', 1, totalSteps);
      const pages = [
        options.existingKnowledgeBase.parentPage,
        ...options.existingKnowledgeBase.childPages,
      ];
      this.log(`Reusing ${pages.length - 1} existing page(s).`);
      return pages;
    }

    this.log('Uploading knowledge base to Confluence...', 1, totalSteps);

    const client = new PlaywrightConfluenceClient(page, context);
    const confluence = new ConfluenceService(client, this.onProgress);

    const pages = await confluence.uploadKnowledgeBase({
      confluenceBaseUrl: options.confluenceBaseUrl!.replace(/\/+$/, ''),
      confluenceSpaceKey: options.confluenceSpaceKey!,
      agentName: options.config.identity.name,
      files: options.knowledgeBaseFiles!,
      overwrite: options.knowledgeBaseStrategy === 'overwrite'
        ? options.existingKnowledgeBase
        : undefined,
    });

    this.log(`Knowledge base uploaded (${pages.length - 1} page(s) created).`);
    return pages;
  }
}
