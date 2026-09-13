/* Test DOM adapters intentionally create their lightweight input callbacks inline. */
/* eslint-disable react-perf/jsx-no-new-function-as-prop */
/** @vitest-environment jsdom */
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { DaemonClient } from "@fde/client/internal/daemon-client";
import { ProjectImportDialog } from "./dialog";
interface MockProps {
  children?: React.ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  initialValue?: string;
  accessibilityLabel?: string;
  onChangeText?: (value: string) => void;
}
const noop = () => {};
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("react-native-unistyles", () => ({ StyleSheet: { create: () => ({}) } }));
vi.mock("react-native", () => ({
  View: ({ children }: MockProps) => <div>{children}</div>,
  ScrollView: ({ children }: MockProps) => <div>{children}</div>,
  Text: ({ children }: MockProps) => <span>{children}</span>,
  Pressable: ({ children, onPress, disabled }: MockProps) => (
    <button type="button" disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock("@/components/adaptive-modal-sheet", () => ({
  AdaptiveModalSheet: ({ children }: MockProps) => <div>{children}</div>,
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onPress, disabled }: MockProps) => (
    <button type="button" disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock("@/components/ui/text-input", () => ({
  EditingTextInput: ({ initialValue, onChangeText, accessibilityLabel }: MockProps) => (
    <input
      aria-label={accessibilityLabel}
      defaultValue={initialValue}
      onChange={(event) => onChangeText?.(event.target.value)}
    />
  ),
}));
vi.mock("./files", () => ({
  supportsLocalImport: false,
  selectImportFiles: vi.fn(),
  readImportChunk: vi.fn(),
}));
afterEach(cleanup);
const makeClient = () => ({
  projectImportPrepare: vi
    .fn()
    .mockResolvedValue({ importId: "ticket", cwd: "/project", projectId: null, error: null }),
  projectImportPreview: vi.fn().mockResolvedValue({
    error: null,
    sessions: [
      { id: "session", provider: "claude", title: "Existing conversation", mode: "resumable" },
    ],
  }),
  projectImportCommit: vi.fn().mockResolvedValue({
    error: null,
    projectId: "project",
    importedAgentIds: ["agent"],
    failures: [],
  }),
  projectImportList: vi.fn().mockResolvedValue({ error: null, conversations: [] }),
  projectImportCancel: vi.fn().mockResolvedValue({ error: null }),
});
it("previews before committing selected native conversations", async () => {
  const client = makeClient();
  render(
    <ProjectImportDialog
      client={client as unknown as DaemonClient}
      hostLabel="Remote daemon"
      onClose={noop}
    />,
  );
  fireEvent.change(screen.getByLabelText("projectImport.destination"), {
    target: { value: "/project" },
  });
  fireEvent.click(screen.getByText("projectImport.preview"));
  await screen.findByText(/Existing conversation/);
  expect(client.projectImportPrepare).toHaveBeenCalledWith({ source: "daemon", cwd: "/project" });
  expect(client.projectImportCommit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("projectImport.import"));
  await screen.findByText("projectImport.complete");
  expect(client.projectImportCommit).toHaveBeenCalledWith("ticket", ["session"]);
});
it("retains source input and reports preview errors", async () => {
  const client = makeClient();
  client.projectImportPreview.mockResolvedValue({ error: "Provider unavailable" });
  render(
    <ProjectImportDialog
      client={client as unknown as DaemonClient}
      hostLabel="Host"
      onClose={noop}
    />,
  );
  fireEvent.change(screen.getByLabelText("projectImport.destination"), {
    target: { value: "/project" },
  });
  fireEvent.click(screen.getByText("projectImport.preview"));
  await screen.findByText("Provider unavailable");
  expect((screen.getByLabelText("projectImport.destination") as HTMLInputElement).value).toBe(
    "/project",
  );
  expect(client.projectImportCommit).not.toHaveBeenCalled();
});
