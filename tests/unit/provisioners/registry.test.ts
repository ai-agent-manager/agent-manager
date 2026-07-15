import { describe, it, expect } from "vitest";
import {
  SKILL_PROVISIONER_CLASSES,
  createSkillProvisioner,
  formatSupportedSkillToolIds,
  getSkillToolIds,
  getSkillTools,
} from "../../../src/provisioners/registry.js";

describe("skill provisioner registry", () => {
  it("registers each provisioner class with a unique id", () => {
    expect(SKILL_PROVISIONER_CLASSES.length).toBeGreaterThan(0);

    const ids = SKILL_PROVISIONER_CLASSES.map((ProvisionerClass) => new ProvisionerClass().id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps SKILL_TOOLS in sync with the registry", () => {
    expect(getSkillToolIds()).toEqual(
      getSkillTools()
        .map((tool) => tool.id)
        .sort(),
    );
  });

  it("creates provisioners for every registered tool id", () => {
    for (const toolId of getSkillToolIds()) {
      const provisioner = createSkillProvisioner(toolId, "system");
      expect(provisioner.id).toBe(toolId);
    }
  });

  it("lists supported tool ids for error messages", () => {
    expect(formatSupportedSkillToolIds()).toContain("'agents'");
    expect(formatSupportedSkillToolIds()).toContain("'claude-code'");
  });

  it("throws for unknown tool ids", () => {
    expect(() => createSkillProvisioner("unknown-tool", "system")).toThrow(/Unknown tool: unknown-tool/);
  });
});
