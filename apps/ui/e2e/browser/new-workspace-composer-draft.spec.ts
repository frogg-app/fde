import { expect, test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { getE2EDaemonPort } from "../support/helpers/daemon-port";
import {
  expectNewWorkspaceDraft,
  expectNewWorkspaceProjectSelected,
  fillNewWorkspaceDraft,
  openGlobalNewWorkspaceComposer,
  openNewWorkspaceComposer,
  selectNewWorkspaceHost,
  selectNewWorkspaceProject,
  selectWorkspaceIsolation,
  openStartingRefPicker,
  selectBranchInPicker,
} from "../support/helpers/new-workspace";
import { seedWorkspace, type SeededWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import { seedSavedSettingsHosts } from "../support/helpers/settings";
import { attachImageFromMenu, expectAttachmentPill } from "../support/helpers/composer";
import {
  switchWorkspaceViaSidebar,
  waitForSidebarHydration,
} from "../support/helpers/workspace-ui";

const DRAFT = `Please investigate the workspace startup failure.

Trace the request from the app through the daemon, preserve the existing behavior, and explain the root cause before making changes.`;

test.describe("New workspace composer draft", () => {
  test.describe.configure({ timeout: 240_000 });

  test("returns to an untitled draft from the sidebar with its text, image and selections", async ({
    page,
  }) => {
    const project = await seedWorkspace({
      repoPrefix: "new-workspace-sidebar-draft-",
      repo: { branches: ["main", "dev"] },
    });
    try {
      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await openNewWorkspaceComposer(page, {
        projectKey: project.projectKey,
        projectDisplayName: project.projectDisplayName,
      });
      const draftRow = page.getByTestId("sidebar-workspace-draft-new-workspace");
      await expect(draftRow).toBeVisible();
      await expect(draftRow).toContainText("New workspace (draft)");
      await fillNewWorkspaceDraft(page, DRAFT);
      await attachImageFromMenu(page, {
        name: "draft.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
          "base64",
        ),
      });
      await expectAttachmentPill(page, "composer-image-attachment-pill");
      await selectWorkspaceIsolation(page, "worktree");
      await openStartingRefPicker(page);
      await selectBranchInPicker(page, "dev");
      const modelSelector = page
        .getByTestId("combined-model-selector")
        .filter({ visible: true })
        .first();
      await expect(modelSelector).toBeVisible();
      await expect(modelSelector).toBeEnabled();
      const modelLabel = await modelSelector.innerText();
      await switchWorkspaceViaSidebar({
        page,
        serverId: getServerId(),
        workspaceId: project.workspaceId,
      });
      await expect(draftRow).toBeVisible();
      await draftRow.click();
      await expectNewWorkspaceDraft(page, DRAFT);
      await expectNewWorkspaceProjectSelected(page, project.projectDisplayName);
      await expectAttachmentPill(page, "composer-image-attachment-pill");
      await expect(page.getByTestId("new-workspace-ref-picker-trigger")).toContainText("dev");
      await expect(modelSelector).toHaveText(modelLabel);
    } finally {
      await project.cleanup();
    }
  });

  test("honors a new project entry while another draft exists", async ({ page }) => {
    const firstProject: SeededWorkspace = await seedWorkspace({
      repoPrefix: "new-workspace-draft-project-a-",
    });
    const secondProject: SeededWorkspace = await seedWorkspace({
      repoPrefix: "new-workspace-draft-project-b-",
    });

    try {
      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await openNewWorkspaceComposer(page, {
        projectKey: firstProject.projectKey,
        projectDisplayName: firstProject.projectDisplayName,
      });
      await expectNewWorkspaceProjectSelected(page, firstProject.projectDisplayName);

      await fillNewWorkspaceDraft(page, DRAFT);

      await openNewWorkspaceComposer(page, {
        projectKey: secondProject.projectKey,
        projectDisplayName: secondProject.projectDisplayName,
      });

      await expectNewWorkspaceProjectSelected(page, secondProject.projectDisplayName);
      await expectNewWorkspaceDraft(page, DRAFT);
      await selectNewWorkspaceProject(page, {
        projectKey: firstProject.projectKey,
        projectDisplayName: firstProject.projectDisplayName,
      });
      await expectNewWorkspaceProjectSelected(page, firstProject.projectDisplayName);
      await expectNewWorkspaceDraft(page, DRAFT);
    } finally {
      await secondProject.cleanup();
      await firstProject.cleanup();
    }
  });

  test("keeps the draft when the host changes", async ({ page }) => {
    const project: SeededWorkspace = await seedWorkspace({
      repoPrefix: "new-workspace-draft-host-",
    });
    const secondaryServerId = "new-workspace-draft-secondary-host";

    try {
      await seedSavedSettingsHosts(page, [
        {
          serverId: getServerId(),
          label: "Primary host",
          endpoint: `127.0.0.1:${getE2EDaemonPort()}`,
        },
        {
          serverId: secondaryServerId,
          label: "Secondary host",
          endpoint: "127.0.0.1:9",
        },
      ]);

      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await openGlobalNewWorkspaceComposer(page);

      await fillNewWorkspaceDraft(page, DRAFT);
      await selectNewWorkspaceHost(page, "Secondary host");

      await expectNewWorkspaceDraft(page, DRAFT);
    } finally {
      await project.cleanup();
    }
  });

  test("does not restore a submitted draft after deferred publication", async ({ page }) => {
    const project = await seedWorkspace({ repoPrefix: "new-workspace-submitted-draft-" });

    try {
      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await openNewWorkspaceComposer(page, {
        projectKey: project.projectKey,
        projectDisplayName: project.projectDisplayName,
      });

      const composer = page.getByRole("textbox", { name: "Message agent..." });
      const createButton = page.getByTestId("workspace-create-submit");
      await expect(composer).toBeEditable({ timeout: 30_000 });
      await expect(createButton).toBeEnabled({ timeout: 30_000 });

      await composer.evaluate((element, draft) => {
        if (!(element instanceof HTMLTextAreaElement)) {
          throw new Error("Composer input is not a textarea");
        }
        const valueSetter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value",
        )?.set;
        if (!valueSetter) throw new Error("Textarea value setter is unavailable");
        valueSetter.call(element, draft);
        element.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            data: draft,
            inputType: "insertText",
          }),
        );
        const button = document.querySelector('[data-testid="workspace-create-submit"]');
        if (!(button instanceof HTMLElement)) {
          throw new Error("Create button is unavailable");
        }
        button.click();
      }, DRAFT);

      await page.waitForURL((url) => url.pathname.includes("/workspace/"), { timeout: 30_000 });
      await expect(page.getByTestId("sidebar-workspace-draft-new-workspace")).toHaveCount(0);
      await openGlobalNewWorkspaceComposer(page);
      await expect(page.getByTestId("sidebar-workspace-draft-new-workspace")).toBeVisible();
      await expectNewWorkspaceDraft(page, "");
    } finally {
      await project.cleanup();
    }
  });
});
