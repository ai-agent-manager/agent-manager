import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { contribute } from "../contribute/index.js";
import { isGithubRepo } from "../contribute/pr.js";
import { LoadingSpinner } from "./Spinner.js";
import { StatusMessage } from "./StatusMessage.js";

type Phase = "skill-path" | "remote-url" | "validating" | "contributing" | "github-pr" | "done" | "error";

interface ContributeScreenProps {
    skillDir: string;
}

export function ContributeScreen({ skillDir }: ContributeScreenProps) {
    const [phase, setPhase] = useState<Phase>("skill-path");
    const [remoteUrl, setRemoteUrl] = useState("");
    const [skillPathInput, setSkillPathInput] = useState(skillDir);
    const [confirmedSkillPath, setConfirmedSkillPath] = useState("");

    // Results
    const [skillName, setSkillName] = useState<string | null>(null);
    const [description, setDescription] = useState<string | null>(null);
    const [branchName, setBranchName] = useState<string | null>(null);
    const [prUrl, setPrUrl] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    // For the PR confirmation step
    const [prConfirmInput, setPrConfirmInput] = useState("");

    useInput((input, key) => {
        if (phase === "done" || phase === "error") {
            if (input === "q" || input === "x") {
                process.exit(0);
            }
            return;
        }

        if (phase === "skill-path" && key.return) {
            const p = skillPathInput.trim();
            if (!p) return;
            setConfirmedSkillPath(p);
            setRemoteUrl("");
            setPhase("remote-url");
            return;
        }

        if (phase === "remote-url" && key.return) {
            const url = remoteUrl.trim();
            if (!url) return;
            setPhase("validating");
            (async () => {
                try {
                    const result = await contribute(confirmedSkillPath, url);

                    if (!result.validated.valid) {
                        setError(`Validation failed: ${result.validated.errors.map((e) => e.message).join("; ")}`);
                        setPhase("error");
                        return;
                    }

                    if ("error" in result.gitResult) {
                        setError(result.gitResult.error);
                        setPhase("error");
                        return;
                    }

                    setSkillName(result.validated.skillName);
                    setDescription(result.validated.description);
                    setBranchName(result.gitResult.branchName);

                    if (isGithubRepo(url) && !result.prOutcome) {
                        setPhase("github-pr");
                    } else if (result.prOutcome?.created) {
                        setPrUrl(result.prOutcome.prUrl);
                        setPhase("done");
                    } else {
                        setPhase("done");
                    }
                } catch (err) {
                    setError(err instanceof Error ? err.message : String(err));
                    setPhase("error");
                }
            })();
            return;
        }

        if (phase === "github-pr" && key.return) {
            const answer = prConfirmInput.trim().toLowerCase();
            if (answer === "y" || answer === "yes") {
                setPhase("contributing");
                (async () => {
                    try {
                        const result = await contribute(confirmedSkillPath, remoteUrl.trim());

                        if (result.prOutcome?.created) {
                            setPrUrl(result.prOutcome.prUrl);
                        }
                        setPhase("done");
                    } catch (err) {
                        setError(err instanceof Error ? err.message : String(err));
                        setPhase("error");
                    }
                })();
            } else {
                setPhase("done");
            }
            return;
        }
    });

    const showSkillPath = phase === "skill-path";
    const showRemoteUrl = phase === "remote-url";
    const showValidating = phase === "validating";
    const showContributing = phase === "contributing";
    const showGithubPr = phase === "github-pr";
    const showDone = phase === "done";
    const showError = phase === "error";

    if (showSkillPath) {
        return (
            <Box flexDirection="column" marginLeft={2}>
                <Text bold>Step 1: Skill Directory</Text>
                <Text>Enter the path to your skill directory:</Text>
                <Box>
                    <Text color="cyan">  </Text>
                    <TextInput
                        value={skillPathInput}
                        onChange={setSkillPathInput}
                        onSubmit={(value) => {
                            const trimmed = value.trim();
                            if (!trimmed) return;
                            setConfirmedSkillPath(trimmed);
                            setRemoteUrl("");
                            setPhase("remote-url");
                        }}
                        placeholder={skillDir}
                    />
                </Box>
                <Text dimColor> Press Enter to continue</Text>
            </Box>
        );
    }

    if (showRemoteUrl) {
        return (
            <Box flexDirection="column" marginLeft={2}>
                <Text bold>Step 2: Remote Git URL</Text>
                <Text color="gray">  Skill directory: {confirmedSkillPath}</Text>
                <Text>Enter the remote git URL to submit to:</Text>
                <Box>
                    <Text color="cyan">  </Text>
                    <TextInput
                        value={remoteUrl}
                        onChange={setRemoteUrl}
                        onSubmit={(value) => {
                            const url = value.trim();
                            if (!url) return;
                            setPhase("validating");
                            (async () => {
                                try {
                                    const result = await contribute(confirmedSkillPath, url);

                                    if (!result.validated.valid) {
                                        setError(`Validation failed: ${result.validated.errors.map((e) => e.message).join("; ")}`);
                                        setPhase("error");
                                        return;
                                    }

                                    if ("error" in result.gitResult) {
                                        setError(result.gitResult.error);
                                        setPhase("error");
                                        return;
                                    }

                                    setSkillName(result.validated.skillName);
                                    setDescription(result.validated.description);
                                    setBranchName(result.gitResult.branchName);

                                    if (isGithubRepo(url) && !result.prOutcome) {
                                        setPhase("github-pr");
                                    } else if (result.prOutcome?.created) {
                                        setPrUrl(result.prOutcome.prUrl);
                                        setPhase("done");
                                    } else {
                                        setPhase("done");
                                    }
                                } catch (err) {
                                    setError(err instanceof Error ? err.message : String(err));
                                    setPhase("error");
                                }
                            })();
                        }}
                        placeholder="https://github.com/org/skills-repo.git"
                    />
                </Box>
                <Text dimColor> Press Enter to continue</Text>
            </Box>
        );
    }

    if (showValidating) {
        return (
            <Box flexDirection="column" marginLeft={2}>
                <LoadingSpinner message="Validating skill directory..." />
                <LoadingSpinner message="Cloning repository and submitting skill..." />
            </Box>
        );
    }

    if (showContributing) {
        return (
            <Box flexDirection="column" marginLeft={2}>
                <LoadingSpinner message="Creating draft pull request..." />
            </Box>
        );
    }

    if (showGithubPr) {
        return (
            <Box flexDirection="column" marginLeft={2}>
                <StatusMessage type="success" message="Skill submitted successfully!" />
                <Text> </Text>
                <StatusMessage type="info" message="Branch created and pushed." />
                <Text> </Text>
                <Text>This is a GitHub repository. Create a draft pull request?</Text>
                <Box>
                    <Text color="cyan">  </Text>
                    <TextInput
                        value={prConfirmInput}
                        onChange={setPrConfirmInput}
                        onSubmit={(value) => {
                            const answer = value.trim().toLowerCase();
                            if (answer === "y" || answer === "yes") {
                                setPhase("contributing");
                                (async () => {
                                    try {
                                        const result = await contribute(confirmedSkillPath, remoteUrl.trim());

                                        if (result.prOutcome?.created) {
                                            setPrUrl(result.prOutcome.prUrl);
                                        }
                                        setPhase("done");
                                    } catch (err) {
                                        setError(err instanceof Error ? err.message : String(err));
                                        setPhase("error");
                                    }
                                })();
                            } else {
                                setPhase("done");
                            }
                        }}
                        placeholder="Yes/No"
                    />
                </Box>
                <Text dimColor> Press Enter to confirm</Text>
            </Box>
        );
    }

    if (showDone) {
        return (
            <Box flexDirection="column" marginLeft={2}>
                <StatusMessage type="success" message="Contribution complete!" />
                <Text> </Text>
                {branchName && <StatusMessage type="info" message={`Branch: ${branchName}`} />}
                {skillName && <StatusMessage type="info" message={`Skill: ${skillName}`} />}
                {prUrl && <StatusMessage type="success" message={`PR URL: ${prUrl}`} />}
                <Text> </Text>
                <Text dimColor> Press q to exit</Text>
            </Box>
        );
    }

    if (showError) {
        return (
            <Box flexDirection="column" marginLeft={2}>
                <StatusMessage type="error" message={error || "An error occurred"} />
                <Text> </Text>
                <Text dimColor> Press q to exit</Text>
            </Box>
        );
    }

    return null;
}
