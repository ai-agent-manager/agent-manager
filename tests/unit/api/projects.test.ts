import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Project } from '../../../src/api/types.js';
import type { AuthSession } from '../../../src/auth/index.js';

const getValidBearerToken = vi.fn();

vi.mock('../../../src/auth/index.js', async () => {
  const actual = await vi.importActual<typeof import('../../../src/auth/index.js')>(
    '../../../src/auth/index.js',
  );
  return {
    ...actual,
    getValidBearerToken: (...args: unknown[]) => getValidBearerToken(...args),
  };
});

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const { listProjects, getProject } = await import('../../../src/api/projects.js');

const authSession: AuthSession = {
  discoveryBaseUrl: 'https://discovery.example.com',
  auth: {
    required: true,
    oidcDiscoveryUrl: 'https://idp.example.com/.well-known/openid-configuration',
    clientId: 'agentman-cli',
  },
};

const sampleProject: Project = {
  id: 'proj-1',
  teamId: 'team-1',
  name: 'Alpha',
  description: 'First project',
  toolIds: ['claude-code', 'cursor'],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

describe('listProjects', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    getValidBearerToken.mockReset();
    getValidBearerToken.mockResolvedValue('bearer-token');
  });

  it('GETs /projects from the API base URL', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [sampleProject],
    });

    const projects = await listProjects('https://api.example.com', authSession);

    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject(sampleProject);
    expect(projects[0]).toMatchObject({
      restrictAgents: false,
      restrictSkills: false,
      allowedAgentIds: [],
      allowedSkillIds: [],
    });
    expect(getValidBearerToken).toHaveBeenCalledWith(
      authSession.discoveryBaseUrl,
      authSession.auth,
      { requestUrl: 'https://api.example.com/projects' },
    );
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/projects',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer bearer-token',
        }),
      }),
    );
  });

  it('returns an empty list when the user has no projects', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [],
    });

    const projects = await listProjects('https://api.example.com', authSession);
    expect(projects).toEqual([]);
  });

  it('normalises missing restriction fields on list responses', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [{ ...sampleProject }],
    });

    const projects = await listProjects('https://api.example.com', authSession);
    expect(projects[0]).toMatchObject({
      restrictAgents: false,
      restrictSkills: false,
      allowedAgentIds: [],
      allowedSkillIds: [],
    });
  });
});

describe('getProject', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    getValidBearerToken.mockReset();
    getValidBearerToken.mockResolvedValue('token');
  });

  it('GETs /projects/{id} from the API base URL', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => sampleProject,
    });

    const project = await getProject('https://api.example.com', authSession, 'proj-1');

    expect(project).toMatchObject(sampleProject);
    expect(project).toMatchObject({
      restrictAgents: false,
      restrictSkills: false,
      allowedAgentIds: [],
      allowedSkillIds: [],
    });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/projects/proj-1',
      expect.any(Object),
    );
  });

  it('URL-encodes the project ID', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => sampleProject,
    });

    await getProject('https://api.example.com', authSession, 'proj/with spaces');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/projects/proj%2Fwith%20spaces',
      expect.any(Object),
    );
  });

  it('returns null on 404', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => 'Not found',
    });

    const project = await getProject('https://api.example.com', authSession, 'missing');
    expect(project).toBeNull();
  });

  it('returns null on 403', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => 'Forbidden',
    });

    const project = await getProject('https://api.example.com', authSession, 'blocked');
    expect(project).toBeNull();
  });

  it('rethrows auth and transient errors', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'Boom',
    });

    await expect(
      getProject('https://api.example.com', authSession, 'proj-1'),
    ).rejects.toThrow('API error 500');

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'Unauthorised',
    });
    // Session auth retries once on 401; both attempts fail.
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'Unauthorised',
    });

    await expect(
      getProject('https://api.example.com', authSession, 'proj-1'),
    ).rejects.toThrow('API error 401');
  });
});
