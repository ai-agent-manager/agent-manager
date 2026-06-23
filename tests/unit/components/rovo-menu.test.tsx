import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "ink-testing-library";
import type { RovoAgentConfig } from "../../../src/bundle/scanner.js";
import type { ExistingKnowledgeBase, KnowledgePage } from "../../../src/services/confluence/types.js";
import type { CreateAgentResult } from "../../../src/services/studio/types.js";

const { trackTelemetryEvent, trackTelemetryError } = vi.hoisted(() => ({
  trackTelemetryEvent: vi.fn(),
  trackTelemetryError: vi.fn(),
}));

vi.mock("../../../src/telemetry.js", () => ({
  trackTelemetryEvent,
  trackTelemetryError,
}));

// ---------------------------------------------------------------------------
// Mock RovoProvisioner so no Playwright or filesystem calls are made.
// ---------------------------------------------------------------------------

const mockProvisioner = {
  detect: vi.fn<() => Promise<{ available: boolean; reason?: string }>>(),
  hasValidAuth: vi.fn<() => Promise<boolean>>(),
  authenticate: vi.fn<(studioUrl: string) => Promise<void>>(),
  checkExistingKnowledgeBase: vi.fn<(input: object) => Promise<ExistingKnowledgeBase | null>>(),
  createAgent: vi.fn<(input: object) => Promise<CreateAgentResult>>(),
};

vi.mock("../../../src/provisioners/RovoProvisioner.js", () => ({
  RovoProvisioner: vi.fn(function MockRovoProvisioner() {
    return mockProvisioner;
  }),
}));

// Import AFTER mock declarations
import { testing } from "../../../src/components/RovoMenu.js";

const { CheckAuth, Authenticate, CheckKbExists, Provision } = testing;

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const STUDIO_URL = "https://studio.atlassian.com/s/test/agents";

const ROVO_CONFIG: RovoAgentConfig = {
  apiVersion: "rovo.atlassian.com/v1",
  kind: "StudioAgent",
  identity: {
    name: "Test Agent",
    description: "A test agent",
    behavior: "Be helpful",
  },
  scenarios: {
    default: { instructions: "Do the thing" },
  },
};

const EXISTING_KB: ExistingKnowledgeBase = {
  parentPage: { title: "Test Agent KB", url: "https://company.atlassian.net/wiki/spaces/TEAM/pages/1" },
  childPages: [{ title: "Page One", url: "https://company.atlassian.net/wiki/spaces/TEAM/pages/2" }],
};

const CREATE_RESULT: CreateAgentResult = {
  knowledgePages: [] as KnowledgePage[],
};

// ---------------------------------------------------------------------------
// CheckAuth
// ---------------------------------------------------------------------------

describe("CheckAuth", () => {
  beforeEach(() => vi.clearAllMocks());

  const telemetryProps = {
    source: "url",
    bundleEndpoint: "https://example.com/skills",
  };

  it("renders the checking spinner while detect is pending", () => {
    mockProvisioner.detect.mockReturnValue(new Promise(() => {}));
    const { lastFrame } = render(
      <CheckAuth
        studioUrl={STUDIO_URL}
        bundleTelemetryProps={telemetryProps}
        onHasAuth={vi.fn()}
        onNeedsAuth={vi.fn()}
        onError={vi.fn()}
      />,
    );
    expect(lastFrame()).toContain("Checking authentication");
  });

  it("calls onHasAuth when Playwright is available and auth is valid", async () => {
    mockProvisioner.detect.mockResolvedValue({ available: true });
    mockProvisioner.hasValidAuth.mockResolvedValue(true);
    const onHasAuth = vi.fn();
    render(
      <CheckAuth
        studioUrl={STUDIO_URL}
        bundleTelemetryProps={telemetryProps}
        onHasAuth={onHasAuth}
        onNeedsAuth={vi.fn()}
        onError={vi.fn()}
      />,
    );
    await vi.waitFor(() => expect(onHasAuth).toHaveBeenCalled());
  });

  it("calls onNeedsAuth when Playwright is available but auth is not valid", async () => {
    mockProvisioner.detect.mockResolvedValue({ available: true });
    mockProvisioner.hasValidAuth.mockResolvedValue(false);
    const onNeedsAuth = vi.fn();
    render(
      <CheckAuth
        studioUrl={STUDIO_URL}
        bundleTelemetryProps={telemetryProps}
        onHasAuth={vi.fn()}
        onNeedsAuth={onNeedsAuth}
        onError={vi.fn()}
      />,
    );
    await vi.waitFor(() => expect(onNeedsAuth).toHaveBeenCalled());
  });

  it("calls onError with the reason when Playwright is not available", async () => {
    mockProvisioner.detect.mockResolvedValue({ available: false, reason: "Playwright not installed" });
    const onError = vi.fn();
    render(
      <CheckAuth
        studioUrl={STUDIO_URL}
        bundleTelemetryProps={telemetryProps}
        onHasAuth={vi.fn()}
        onNeedsAuth={vi.fn()}
        onError={onError}
      />,
    );
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith("Playwright not installed"));
  });

  it("calls onError when detect throws", async () => {
    mockProvisioner.detect.mockRejectedValue(new Error("network failure"));
    const onError = vi.fn();
    render(
      <CheckAuth
        studioUrl={STUDIO_URL}
        bundleTelemetryProps={telemetryProps}
        onHasAuth={vi.fn()}
        onNeedsAuth={vi.fn()}
        onError={onError}
      />,
    );
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith("network failure"));
    expect(trackTelemetryError).toHaveBeenCalledWith("rovo_auth_check_failed", expect.any(Error), telemetryProps);
  });
});

// ---------------------------------------------------------------------------
// Authenticate
// ---------------------------------------------------------------------------

describe("Authenticate", () => {
  beforeEach(() => vi.clearAllMocks());

  const telemetryProps = {
    source: "url",
    bundleEndpoint: "https://example.com/skills",
  };

  it('renders "Launching browser..." when no progress message is set', () => {
    mockProvisioner.authenticate.mockReturnValue(new Promise(() => {}));
    const { lastFrame } = render(
      <Authenticate
        studioUrl={STUDIO_URL}
        bundleTelemetryProps={telemetryProps}
        onProgress={vi.fn()}
        onSuccess={vi.fn()}
        onError={vi.fn()}
        progress=""
      />,
    );
    expect(lastFrame()).toContain("Launching browser");
  });

  it("renders the progress message when one is provided", () => {
    mockProvisioner.authenticate.mockReturnValue(new Promise(() => {}));
    const { lastFrame } = render(
      <Authenticate
        studioUrl={STUDIO_URL}
        bundleTelemetryProps={telemetryProps}
        onProgress={vi.fn()}
        onSuccess={vi.fn()}
        onError={vi.fn()}
        progress="Waiting for login..."
      />,
    );
    expect(lastFrame()).toContain("Waiting for login...");
  });

  it("calls onSuccess when authenticate resolves", async () => {
    mockProvisioner.authenticate.mockResolvedValue(undefined);
    const onSuccess = vi.fn();
    render(
      <Authenticate
        studioUrl={STUDIO_URL}
        bundleTelemetryProps={telemetryProps}
        onProgress={vi.fn()}
        onSuccess={onSuccess}
        onError={vi.fn()}
        progress=""
      />,
    );
    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalled());
  });

  it("calls onError when authenticate throws", async () => {
    mockProvisioner.authenticate.mockRejectedValue(new Error("browser crashed"));
    const onError = vi.fn();
    render(
      <Authenticate
        studioUrl={STUDIO_URL}
        bundleTelemetryProps={telemetryProps}
        onProgress={vi.fn()}
        onSuccess={vi.fn()}
        onError={onError}
        progress=""
      />,
    );
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith("browser crashed"));
    expect(trackTelemetryError).toHaveBeenCalledWith("rovo_authenticate_failed", expect.any(Error), telemetryProps);
  });
});

// ---------------------------------------------------------------------------
// CheckKbExists
// ---------------------------------------------------------------------------

describe("CheckKbExists", () => {
  beforeEach(() => vi.clearAllMocks());

  const defaultProps = {
    confluenceBaseUrl: "https://company.atlassian.net",
    confluenceSpaceKey: "TEAM",
    agentName: "Test Agent",
    bundleTelemetryProps: {
      source: "url",
      bundleEndpoint: "https://example.com/skills",
    },
    onExists: vi.fn(),
    onNotExists: vi.fn(),
    onError: vi.fn(),
  };

  it("renders the checking spinner while the check is pending", () => {
    mockProvisioner.checkExistingKnowledgeBase.mockReturnValue(new Promise(() => {}));
    const { lastFrame } = render(<CheckKbExists {...defaultProps} />);
    expect(lastFrame()).toContain("Checking for existing");
  });

  it("calls onExists with the existing KB when pages are found", async () => {
    mockProvisioner.checkExistingKnowledgeBase.mockResolvedValue(EXISTING_KB);
    const onExists = vi.fn();
    render(<CheckKbExists {...defaultProps} onExists={onExists} />);
    await vi.waitFor(() => expect(onExists).toHaveBeenCalledWith(EXISTING_KB));
  });

  it("calls onNotExists when no pages are found", async () => {
    mockProvisioner.checkExistingKnowledgeBase.mockResolvedValue(null);
    const onNotExists = vi.fn();
    render(<CheckKbExists {...defaultProps} onNotExists={onNotExists} />);
    await vi.waitFor(() => expect(onNotExists).toHaveBeenCalled());
  });

  it("calls onError when checkExistingKnowledgeBase throws", async () => {
    mockProvisioner.checkExistingKnowledgeBase.mockRejectedValue(new Error("Confluence unreachable"));
    const onError = vi.fn();
    render(<CheckKbExists {...defaultProps} onError={onError} />);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith("Confluence unreachable"));
    expect(trackTelemetryError).toHaveBeenCalledWith("rovo_kb_check_failed", expect.any(Error), {
      source: "url",
      bundleEndpoint: "https://example.com/skills",
    });
  });
});

// ---------------------------------------------------------------------------
// Provision
// ---------------------------------------------------------------------------

describe("Provision", () => {
  beforeEach(() => vi.clearAllMocks());

  const defaultProps = {
    studioUrl: STUDIO_URL,
    config: ROVO_CONFIG,
    headless: true,
    bundleTelemetryProps: {
      source: "url",
      bundleEndpoint: "https://example.com/skills",
    },
    onProgress: vi.fn(),
    onSuccess: vi.fn(),
    onError: vi.fn(),
    progress: "",
  };

  it('renders "Starting..." when no progress message is set', () => {
    mockProvisioner.createAgent.mockReturnValue(new Promise(() => {}));
    const { lastFrame } = render(<Provision {...defaultProps} />);
    expect(lastFrame()).toContain("Starting...");
  });

  it("renders the progress message when one is provided", () => {
    mockProvisioner.createAgent.mockReturnValue(new Promise(() => {}));
    const { lastFrame } = render(<Provision {...defaultProps} progress="Filling in form..." />);
    expect(lastFrame()).toContain("Filling in form...");
  });

  it("calls onSuccess with the result when createAgent resolves", async () => {
    mockProvisioner.createAgent.mockResolvedValue(CREATE_RESULT);
    const onSuccess = vi.fn();
    render(<Provision {...defaultProps} onSuccess={onSuccess} />);
    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledWith(CREATE_RESULT));
    expect(trackTelemetryEvent).toHaveBeenCalledWith({
      action: "rovo_provision_started",
      properties: {
        source: "url",
        bundleEndpoint: "https://example.com/skills",
        mode: "headless",
        knowledgeBase: "no",
        knowledgeStrategy: "new",
      },
    });
    expect(trackTelemetryEvent).toHaveBeenCalledWith({
      action: "rovo_provision_succeeded",
      properties: {
        source: "url",
        bundleEndpoint: "https://example.com/skills",
        mode: "headless",
        knowledgeBase: "no",
        knowledgePages: 0,
      },
      value: 0,
    });
  });

  it("calls onError when createAgent throws", async () => {
    mockProvisioner.createAgent.mockRejectedValue(new Error("Studio timeout"));
    const onError = vi.fn();
    render(<Provision {...defaultProps} onError={onError} />);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith("Studio timeout"));
    expect(trackTelemetryError).toHaveBeenCalledWith("rovo_provision_failed", expect.any(Error), {
      source: "url",
      bundleEndpoint: "https://example.com/skills",
      mode: "headless",
      knowledgeBase: "no",
    });
  });
});
