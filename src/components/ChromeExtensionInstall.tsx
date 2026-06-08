import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import { installChromeExtension } from "../lib/chrome-extension-installer.js";
import { LoadingSpinner } from "./Spinner.js";
import { StatusMessage } from "./StatusMessage.js";

interface ChromeExtensionInstallProps {
  onBack: () => void;
}

type InstallState = "installing" | "installed" | "manual-required" | "error";

export function ChromeExtensionInstall({ onBack }: ChromeExtensionInstallProps) {
  const [state, setState] = useState<InstallState>("installing");
  const [crxPath, setCrxPath] = useState("");
  const [jsonPath, setJsonPath] = useState("");
  const [manualInstructions, setManualInstructions] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    (async () => {
      const result = await installChromeExtension();
      switch (result.status) {
        case "installed":
          setCrxPath(result.crxPath);
          setJsonPath(result.jsonPath);
          setState("installed");
          break;
        case "manual-required":
          setManualInstructions(result.instructions);
          setState("manual-required");
          break;
        case "error":
          setErrorMessage(result.message);
          setState("error");
          break;
      }
    })();
  }, []);

  const backItem = [{ label: "\u2190 Back to menu", value: "back" }];

  if (state === "installing") {
    return (
      <Box flexDirection="column" marginLeft={2}>
        <Text bold>Install Chrome Extension</Text>
        <Text> </Text>
        <LoadingSpinner message="Installing Chrome extension..." />
      </Box>
    );
  }

  if (state === "error") {
    return (
      <Box flexDirection="column" marginLeft={2}>
        <Text bold>Install Chrome Extension</Text>
        <Text> </Text>
        <StatusMessage type="error" message={errorMessage} />
        <Text> </Text>
        <SelectInput items={backItem} onSelect={() => onBack()} />
      </Box>
    );
  }

  if (state === "manual-required") {
    return (
      <Box flexDirection="column" marginLeft={2}>
        <Text bold>Install Chrome Extension</Text>
        <Text> </Text>
        <StatusMessage type="warning" message="Automatic installation is not supported on this platform." />
        <Text> </Text>
        {manualInstructions.map((line, index) => (
          <Text key={index} dimColor={line === ""}>
            {line === "" ? " " : line}
          </Text>
        ))}
        <Text> </Text>
        <SelectInput items={backItem} onSelect={() => onBack()} />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginLeft={2}>
      <Text bold>Install Chrome Extension</Text>
      <Text> </Text>
      <StatusMessage type="success" message="Chrome extension installed successfully." />
      <Text> </Text>
      <Box flexDirection="column" marginLeft={2}>
        <Text>Next steps:</Text>
        <Text> </Text>
        <Text> 1. Restart Google Chrome</Text>
        <Text> 2. Chrome will prompt you to confirm adding the extension</Text>
        <Text>
          {" "}
          3. Click{" "}
          <Text bold color="cyan">
            Add extension
          </Text>{" "}
          to approve
        </Text>
        <Text> </Text>
        <Text dimColor> Extension file: {crxPath}</Text>
        <Text dimColor> External config: {jsonPath}</Text>
      </Box>
      <Text> </Text>
      <SelectInput items={backItem} onSelect={() => onBack()} />
    </Box>
  );
}
