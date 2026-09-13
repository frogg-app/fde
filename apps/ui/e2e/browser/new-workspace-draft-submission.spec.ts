import { expect, test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { daemonWsRoutePattern } from "../support/helpers/daemon-port";
import {
  openNewWorkspaceComposer,
  selectWorkspaceIsolation,
} from "../support/helpers/new-workspace";
import { seedWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import {
  switchWorkspaceViaSidebar,
  waitForSidebarHydration,
} from "../support/helpers/workspace-ui";

function createRequestId(message: string | Buffer): string | null {
  try {
    const envelope: unknown = JSON.parse(message.toString());
    if (!envelope || typeof envelope !== "object" || !("message" in envelope)) return null;
    const request = envelope.message;
    if (
      !request ||
      typeof request !== "object" ||
      !("type" in request) ||
      !("requestId" in request)
    )
      return null;
    return request.type === "workspace.create.request" && typeof request.requestId === "string"
      ? request.requestId
      : null;
  } catch {
    return null;
  }
}

test("resuming an in-flight draft stays locked and offers retry after failure", async ({
  page,
}) => {
  const project = await seedWorkspace({ repoPrefix: "draft-resume-pending-" });
  const held = {
    count: 0,
    fail: (): void => {
      throw new Error("No create request is pending");
    },
  };
  const failure = "Synthetic creation failure while draft was hidden";
  await page.routeWebSocket(daemonWsRoutePattern(), (browser) => {
    const server = browser.connectToServer();
    browser.onMessage((message) => {
      const requestId = createRequestId(message);
      if (requestId) {
        held.count += 1;
        if (held.count === 1) {
          held.fail = () =>
            browser.send(
              JSON.stringify({
                type: "session",
                message: {
                  type: "workspace.create.response",
                  payload: { requestId, workspace: null, setupTerminalId: null, error: failure },
                },
              }),
            );
          return;
        }
      }
      server.send(message);
    });
    server.onMessage((message) => browser.send(message));
  });
  try {
    await gotoAppShell(page);
    await waitForSidebarHydration(page);
    await openNewWorkspaceComposer(page, {
      projectKey: project.projectKey,
      projectDisplayName: project.projectDisplayName,
    });
    await selectWorkspaceIsolation(page, "local");
    const submit = page.getByTestId("workspace-create-submit");
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect.poll(() => held.count).toBe(1);
    await switchWorkspaceViaSidebar({
      page,
      serverId: getServerId(),
      workspaceId: project.workspaceId,
    });
    await page.getByTestId("sidebar-workspace-draft-new-workspace").click();
    await expect(submit).toBeDisabled();
    held.fail();
    await expect(page.getByText(failure, { exact: true }).first()).toBeVisible();
    await expect(submit).toBeEnabled();
    await submit.click();
    await page.waitForURL((url) => url.pathname.includes("/workspace/"));
    await expect(page.getByTestId("sidebar-workspace-draft-new-workspace")).toHaveCount(0);
    expect(held.count).toBe(2);
  } finally {
    await project.cleanup();
  }
});
