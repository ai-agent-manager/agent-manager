import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfluenceService } from '../../../../src/services/confluence/ConfluenceService.js';
import type { ConfluenceClient, ConfluenceResponse, ExistingKnowledgeBase } from '../../../../src/services/confluence/types.js';
import type { KnowledgeBaseFile } from '../../../../src/bundle/scanner.js';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

// ---------------------------------------------------------------------------
// Mock ConfluenceClient helper
// ---------------------------------------------------------------------------

function mockResponse(data: {
  ok?: boolean;
  status?: number;
  json?: any;
  text?: string;
}): ConfluenceResponse {
  return {
    ok: () => data.ok ?? true,
    status: () => data.status ?? 200,
    json: async () => data.json ?? {},
    text: async () => data.text ?? '',
  };
}

function createMockClient(overrides?: Partial<ConfluenceClient>): ConfluenceClient {
  return {
    init: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(mockResponse({ ok: true, json: { results: [] } })),
    post: vi.fn().mockResolvedValue(mockResponse({ ok: true, json: {} })),
    put: vi.fn().mockResolvedValue(mockResponse({ ok: true, json: {} })),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test temp directory for knowledge-base files
// ---------------------------------------------------------------------------

const tmpDir = path.join(tmpdir(), `confluence-svc-test-${Date.now()}`);

beforeEach(async () => {
  await mkdir(tmpDir, { recursive: true });
});

// Cleanup is best-effort — we don't fail tests if it doesn't work
afterAll(async () => {
  try { await rm(tmpDir, { recursive: true, force: true }); } catch {}
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ConfluenceService', () => {
  describe('checkExistingKnowledgeBase', () => {
    it('returns null when the space is not found', async () => {
      const client = createMockClient({
        get: vi.fn().mockResolvedValue(mockResponse({ ok: true, json: { results: [] } })),
      });
      const svc = new ConfluenceService(client);

      const result = await svc.checkExistingKnowledgeBase({
        confluenceBaseUrl: 'https://example.atlassian.net',
        confluenceSpaceKey: 'NOPE',
        agentName: 'Test Agent',
      });

      expect(result).toBeNull();
    });

    it('returns null when no parent page matches the agent name', async () => {
      const client = createMockClient({
        get: vi.fn()
          // First call: resolve space
          .mockResolvedValueOnce(mockResponse({ ok: true, json: { results: [{ id: 'space-1' }] } }))
          // Second call: search for page — no results
          .mockResolvedValueOnce(mockResponse({ ok: true, json: { results: [] } })),
      });
      const svc = new ConfluenceService(client);

      const result = await svc.checkExistingKnowledgeBase({
        confluenceBaseUrl: 'https://example.atlassian.net',
        confluenceSpaceKey: 'TEAM',
        agentName: 'Test Agent',
      });

      expect(result).toBeNull();
    });

    it('returns parent and child pages when they exist', async () => {
      const client = createMockClient({
        get: vi.fn()
          // resolve space
          .mockResolvedValueOnce(mockResponse({ ok: true, json: { results: [{ id: 'space-1' }] } }))
          // search for parent page
          .mockResolvedValueOnce(mockResponse({
            ok: true,
            json: { results: [{ id: 'page-1', title: 'Test Agent', _links: { webui: '/wiki/pages/1' } }] },
          }))
          // fetch child pages
          .mockResolvedValueOnce(mockResponse({
            ok: true,
            json: {
              results: [
                { id: 'child-1', title: 'Page A', _links: { webui: '/wiki/pages/a' } },
                { id: 'child-2', title: 'Page B', _links: { webui: '/wiki/pages/b' } },
              ],
            },
          })),
      });
      const svc = new ConfluenceService(client);

      const result = await svc.checkExistingKnowledgeBase({
        confluenceBaseUrl: 'https://example.atlassian.net',
        confluenceSpaceKey: 'TEAM',
        agentName: 'Test Agent',
      });

      expect(result).not.toBeNull();
      expect(result!.parentPage.title).toBe('Test Agent');
      expect(result!.parentPage.url).toBe('https://example.atlassian.net/wiki/pages/1');
      expect(result!.childPages).toHaveLength(2);
      expect(result!.childPages[0].title).toBe('Page A');
      expect(result!.childPages[1].title).toBe('Page B');
    });

    it('calls client.init with the confluence base URL', async () => {
      const client = createMockClient();
      const svc = new ConfluenceService(client);

      await svc.checkExistingKnowledgeBase({
        confluenceBaseUrl: 'https://example.atlassian.net/',
        confluenceSpaceKey: 'TEAM',
        agentName: 'Agent',
      });

      expect(client.init).toHaveBeenCalledWith('https://example.atlassian.net');
    });
  });

  describe('uploadKnowledgeBase — create mode', () => {
    it('creates a parent page and child pages', async () => {
      // Write test markdown files
      const file1Path = path.join(tmpDir, 'page1.md');
      const file2Path = path.join(tmpDir, 'page2.md');
      await writeFile(file1Path, '# Page 1\nContent');
      await writeFile(file2Path, '# Page 2\nContent');

      const files: KnowledgeBaseFile[] = [
        { title: 'Page 1', filePath: file1Path },
        { title: 'Page 2', filePath: file2Path },
      ];

      const client = createMockClient({
        get: vi.fn()
          // resolve space
          .mockResolvedValueOnce(mockResponse({ ok: true, json: { results: [{ id: 'space-1' }] } })),
        post: vi.fn()
          // create parent
          .mockResolvedValueOnce(mockResponse({
            ok: true,
            json: { id: 'parent-1', _links: { webui: '/wiki/pages/parent' } },
          }))
          // create child 1
          .mockResolvedValueOnce(mockResponse({
            ok: true,
            json: { id: 'child-1', _links: { webui: '/wiki/pages/child1' } },
          }))
          // create child 2
          .mockResolvedValueOnce(mockResponse({
            ok: true,
            json: { id: 'child-2', _links: { webui: '/wiki/pages/child2' } },
          })),
      });
      const svc = new ConfluenceService(client);

      const pages = await svc.uploadKnowledgeBase({
        confluenceBaseUrl: 'https://example.atlassian.net',
        confluenceSpaceKey: 'TEAM',
        agentName: 'Test Agent',
        files,
      });

      expect(pages).toHaveLength(3); // parent + 2 children
      expect(pages[0].title).toBe('Test Agent');
      expect(pages[0].url).toBe('https://example.atlassian.net/wiki/pages/parent');
      expect(pages[1].title).toBe('Page 1');
      expect(pages[2].title).toBe('Page 2');
    });

    it('throws when space is not found', async () => {
      const client = createMockClient({
        get: vi.fn().mockResolvedValueOnce(mockResponse({ ok: true, json: { results: [] } })),
      });
      const svc = new ConfluenceService(client);

      await expect(svc.uploadKnowledgeBase({
        confluenceBaseUrl: 'https://example.atlassian.net',
        confluenceSpaceKey: 'NOPE',
        agentName: 'Agent',
        files: [],
      })).rejects.toThrow('was not found');
    });

    it('throws when parent page creation fails', async () => {
      const client = createMockClient({
        get: vi.fn()
          .mockResolvedValueOnce(mockResponse({ ok: true, json: { results: [{ id: 'space-1' }] } })),
        post: vi.fn()
          .mockResolvedValueOnce(mockResponse({ ok: false, status: 400, text: 'Bad Request' })),
      });
      const svc = new ConfluenceService(client);

      await expect(svc.uploadKnowledgeBase({
        confluenceBaseUrl: 'https://example.atlassian.net',
        confluenceSpaceKey: 'TEAM',
        agentName: 'Agent',
        files: [],
      })).rejects.toThrow('Failed to create parent Confluence page');
    });

    it('skips files that cannot be read', async () => {
      const files: KnowledgeBaseFile[] = [
        { title: 'Missing', filePath: '/nonexistent/path.md' },
      ];

      const client = createMockClient({
        get: vi.fn()
          .mockResolvedValueOnce(mockResponse({ ok: true, json: { results: [{ id: 'space-1' }] } })),
        post: vi.fn()
          .mockResolvedValueOnce(mockResponse({
            ok: true,
            json: { id: 'parent-1', _links: { webui: '/wiki/pages/parent' } },
          })),
      });
      const progressMessages: string[] = [];
      const svc = new ConfluenceService(client, (msg) => progressMessages.push(msg));

      const pages = await svc.uploadKnowledgeBase({
        confluenceBaseUrl: 'https://example.atlassian.net',
        confluenceSpaceKey: 'TEAM',
        agentName: 'Agent',
        files,
      });

      // Only the parent page — child was skipped
      expect(pages).toHaveLength(1);
      expect(progressMessages.some((m) => m.includes('skipping'))).toBe(true);
    });
  });

  describe('uploadKnowledgeBase — overwrite mode', () => {
    it('updates existing parent and child pages', async () => {
      const filePath = path.join(tmpDir, 'updated.md');
      await writeFile(filePath, '# Updated content');

      const files: KnowledgeBaseFile[] = [
        { title: 'Existing Page', filePath },
      ];

      const existing: ExistingKnowledgeBase = {
        parentPage: { title: 'Agent', url: 'https://example.atlassian.net/wiki/pages/parent' },
        childPages: [{ title: 'Existing Page', url: 'https://example.atlassian.net/wiki/pages/child' }],
      };

      const client = createMockClient({
        get: vi.fn()
          // resolve space
          .mockResolvedValueOnce(mockResponse({ ok: true, json: { results: [{ id: 'space-1' }] } }))
          // search for parent page
          .mockResolvedValueOnce(mockResponse({
            ok: true,
            json: { results: [{ id: 'parent-1', _links: { webui: '/wiki/pages/parent' } }] },
          }))
          // get parent version (v1 API)
          .mockResolvedValueOnce(mockResponse({ ok: true, json: { version: { number: 3 } } }))
          // list child pages
          .mockResolvedValueOnce(mockResponse({
            ok: true,
            json: { results: [{ id: 'child-1', title: 'Existing Page' }] },
          }))
          // get child version (v1 API)
          .mockResolvedValueOnce(mockResponse({ ok: true, json: { version: { number: 2 } } })),
        put: vi.fn()
          // update parent
          .mockResolvedValueOnce(mockResponse({
            ok: true,
            json: { id: 'parent-1', _links: { webui: '/wiki/pages/parent-updated' } },
          }))
          // update child
          .mockResolvedValueOnce(mockResponse({
            ok: true,
            json: { id: 'child-1', _links: { webui: '/wiki/pages/child-updated' } },
          })),
      });
      const svc = new ConfluenceService(client);

      const pages = await svc.uploadKnowledgeBase({
        confluenceBaseUrl: 'https://example.atlassian.net',
        confluenceSpaceKey: 'TEAM',
        agentName: 'Agent',
        files,
        overwrite: existing,
      });

      expect(pages).toHaveLength(2); // parent + 1 child
      expect(pages[0].title).toBe('Agent');
      expect(pages[1].title).toBe('Existing Page');

      // Verify the PUT calls included incremented version numbers
      const putCalls = (client.put as ReturnType<typeof vi.fn>).mock.calls;
      expect(putCalls).toHaveLength(2);
      // Parent version incremented from 3 to 4
      expect((putCalls[0][1] as any).version.number).toBe(4);
      // Child version incremented from 2 to 3
      expect((putCalls[1][1] as any).version.number).toBe(3);
    });
  });
});
