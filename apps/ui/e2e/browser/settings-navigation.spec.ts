import { test, expect } from "../support/fixtures";
import {
  buildHostWorkspaceRoute,
  buildOpenProjectRoute,
  buildSettingsHostRoute,
  buildSettingsHostSectionRoute,
  buildSettingsSectionRoute,
} from "@/utils/host-routes";
import { gotoAppShell, openSettings } from "../support/helpers/app";
import { getE2EDaemonPort } from "../support/helpers/daemon-port";
import {
  clickSettingsBackToWorkspace,
  closeCompactSettings,
  expectAboutContent,
  expectAddHostMethodOptions,
  expectAppearanceContent,
  expectCompactSettingsList,
  expectDiagnosticsContent,
  expectDirectHostFormValues,
  expectDirectHostSslEnabled,
  expectDirectHostUriHidden,
  expectDirectHostUriValue,
  expectGeneralContent,
  expectSettingsBackButton,
  expectSettingsClosed,
  expectSettingsHeader,
  expectHostSettingsSectionSelected,
  expectHostSettingsTitle,
  expectSettingsModalOpen,
  expectSettingsSidebarHidden,
  expectSettingsSidebarSections,
  expectSettingsSidebarVisible,
  fillDirectHostUri,
  goBackInSettings,
  openAddHostFlow,
  openCompactSettings,
  openCompactSettingsHost,
  openSettingsHostSection,
  openSettingsSection,
  removeCurrentHostFromSettings,
  seedSavedSettingsHosts,
  selectHostConnectionType,
  selectSettingsHost,
  toggleHostAdvanced,
  verifyLegacyHostSettingsRedirect,
} from "../support/helpers/settings";
import { getServerId } from "../support/helpers/server-id";
import { expectAppRoute } from "../support/helpers/route-assertions";

async function openWorkspace(
  page: import("@playwright/test").Page,
  workspace: { workspaceId: string },
) {
  await page.goto(buildHostWorkspaceRoute(getServerId(), workspace.workspaceId));
  await expect(page.getByTestId("menu-button")).toBeVisible();
}

test.describe("Settings sidebar navigation", () => {
  test("clicking a sidebar section renders the section", async ({ page }) => {
    await gotoAppShell(page);
    await openSettings(page);

    await openSettingsSection(page, "diagnostics");
    await expectSettingsHeader(page, "Diagnostics");
    await expectDiagnosticsContent(page);

    await openSettingsSection(page, "about");
    await expectSettingsHeader(page, "About");
    await expectAboutContent(page);

    await openSettingsSection(page, "general");
    await expectSettingsHeader(page, "General");
    await expectGeneralContent(page);

    await openSettingsSection(page, "appearance");
    await expectSettingsHeader(page, "Appearance");
    await expectAppearanceContent(page);
  });

  test("/h/[serverId]/settings redirects to the host connections section", async ({ page }) => {
    await gotoAppShell(page);
    await verifyLegacyHostSettingsRedirect(page);
  });

  test("the sidebar Hosts menu lists add-host methods and hosts without opening settings", async ({
    page,
  }) => {
    await gotoAppShell(page);
    await openAddHostFlow(page);
    await expect(page.getByTestId("sidebar-hosts-add-pair-link")).toBeVisible();
    await expect(page.getByTestId(`sidebar-hosts-item-${getServerId()}`)).toBeVisible();
    await expect(page.getByTestId("settings-modal")).toHaveCount(0);
  });

  test("Ctrl+H opens Add host without opening settings", async ({ page }) => {
    await gotoAppShell(page);
    await page.keyboard.press("Control+H");

    await expectAddHostMethodOptions(page);
    await expect(page.getByTestId("settings-modal")).toHaveCount(0);
  });

  test("app settings list only app sections", async ({ page }) => {
    await gotoAppShell(page);
    await openSettings(page);

    const sidebar = page.getByTestId("settings-sidebar");
    await expect(sidebar.getByTestId("settings-section-general")).toBeVisible();
    await expect(sidebar.locator('[data-testid^="settings-host-section-"]')).toHaveCount(0);
  });

  test("a host from the Hosts menu opens settings with only that host's sections", async ({
    page,
  }) => {
    await gotoAppShell(page);
    await selectSettingsHost(page, getServerId());

    const sidebar = page.getByTestId("settings-sidebar");
    await expect(sidebar.getByTestId("settings-host-section-host")).toBeVisible();
    await expect(sidebar.locator('[data-testid^="settings-section-"]')).toHaveCount(0);
    await expectHostSettingsSectionSelected(page, "host");
  });

  test("direct connection advanced URI round-trips SSL and password into the form", async ({
    page,
  }) => {
    await gotoAppShell(page);
    await openAddHostFlow(page);
    await selectHostConnectionType(page, "direct");

    await toggleHostAdvanced(page);
    await fillDirectHostUri(page, "tcp://example.frogg.test:7443?ssl=true&password=shared-secret");
    await toggleHostAdvanced(page);

    await expectDirectHostFormValues(page, {
      host: "example.frogg.test",
      port: "7443",
      password: "shared-secret",
    });
    await expectDirectHostSslEnabled(page);
    await expectDirectHostUriHidden(page);

    await toggleHostAdvanced(page);
    await expectDirectHostUriValue(
      page,
      "tcp://example.frogg.test:7443?ssl=true&password=shared-secret",
    );
    await toggleHostAdvanced(page);
    await expectDirectHostUriHidden(page);
  });

  test("the close button leaves settings", async ({ page }) => {
    await gotoAppShell(page);
    await openSettings(page);
    await clickSettingsBackToWorkspace(page);
    await expectSettingsClosed(page);
  });

  test("pressing Escape closes settings", async ({ page }) => {
    await gotoAppShell(page);
    await openSettings(page);
    await page.keyboard.press("Escape");
    await expectSettingsClosed(page);
  });

  test("Escape lets settings dropdowns and modals close before leaving settings", async ({
    page,
  }) => {
    await gotoAppShell(page);
    await openSettings(page);

    await test.step("a dropdown owns Escape", async () => {
      await openSettingsSection(page, "appearance");
      await page.getByLabel(/Theme:/).click();
      await expect(page.getByRole("menuitem", { name: "System", exact: true })).toBeVisible();

      await page.keyboard.press("Escape");

      await expect(page.getByRole("menuitem", { name: "System", exact: true })).toHaveCount(0);
      await expectSettingsModalOpen(page, "Appearance");
    });

    await test.step("a modal owns Escape", async () => {
      await clickSettingsBackToWorkspace(page);
      await page.keyboard.press("Control+H");
      await expect(page.getByText("Add connection", { exact: true })).toBeVisible();

      await page.keyboard.press("Escape");

      await expect(page.getByText("Add connection", { exact: true })).toHaveCount(0);
      await expectSettingsClosed(page);
    });
  });
});

test.describe("Settings — compact master-detail", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("/settings renders only the sidebar list (no section content)", async ({ page }) => {
    await gotoAppShell(page);
    await openCompactSettings(page, buildOpenProjectRoute());

    await expectSettingsSidebarSections(page, ["general", "diagnostics", "about"]);
    await expectCompactSettingsList(page);

    await expectSettingsBackButton(page);
    await goBackInSettings(page);
    await expect(page).not.toHaveURL(/\/settings(\/|$)/);
  });

  test("tapping a section pushes /settings/[section] and shows a back button", async ({ page }) => {
    await gotoAppShell(page);
    await openCompactSettings(page, buildOpenProjectRoute());

    await openSettingsSection(page, "diagnostics");
    await expectAppRoute(page, buildSettingsSectionRoute("diagnostics"));
    await expectDiagnosticsContent(page);
    await expectSettingsSidebarHidden(page);
    await expectSettingsBackButton(page);
  });

  test("back from a section detail returns to the /settings list", async ({ page }) => {
    await gotoAppShell(page);
    await openCompactSettings(page, buildOpenProjectRoute());

    await openSettingsSection(page, "about");
    await expectAppRoute(page, buildSettingsSectionRoute("about"));

    await goBackInSettings(page);
    await expectCompactSettingsList(page);
    await expectSettingsBackButton(page);
  });

  test("a host's section row pushes /settings/hosts/[serverId]/connections", async ({ page }) => {
    await gotoAppShell(page);
    await openCompactSettings(page, buildOpenProjectRoute());

    await openCompactSettingsHost(page);
    await expectSettingsBackButton(page);
    await expectSettingsSidebarHidden(page);
  });

  test("back from a host detail returns to that host's section list", async ({ page }) => {
    await gotoAppShell(page);

    await openCompactSettingsHost(page);
    await goBackInSettings(page);
    await expectAppRoute(page, buildSettingsHostRoute(getServerId()));
    await expectSettingsSidebarVisible(page);
    await expect(page.getByTestId("settings-host-section-host")).toBeVisible();
  });

  test("Hosts menu opens the host's section list and backs out to the workspace", async ({
    page,
    withWorkspace,
  }) => {
    const workspace = await withWorkspace({ prefix: "hosts-menu-settings-back-" });
    const workspaceRoute = buildHostWorkspaceRoute(getServerId(), workspace.workspaceId);

    await openWorkspace(page, workspace);
    await selectSettingsHost(page, getServerId());
    await expectAppRoute(page, buildSettingsHostRoute(getServerId()));

    await page.getByTestId("settings-host-section-host").click();
    await expectAppRoute(page, buildSettingsHostSectionRoute(getServerId(), "host"));
    await expect(page.getByText("Overview", { exact: true })).toBeVisible();

    await goBackInSettings(page);
    await goBackInSettings(page);
    await expectAppRoute(page, workspaceRoute);
  });

  test("the Hosts menu opens the chosen host's settings titled with its name", async ({ page }) => {
    const primaryServerId = getServerId();
    const secondaryServerId = "srv_e2e_settings_secondary";
    const secondaryHostLabel = "Stable horse";
    const endpoint = `127.0.0.1:${getE2EDaemonPort()}`;

    await seedSavedSettingsHosts(page, [
      { serverId: primaryServerId, label: "First horse", endpoint },
      { serverId: secondaryServerId, label: secondaryHostLabel, endpoint },
    ]);
    await gotoAppShell(page);

    await selectSettingsHost(page, secondaryServerId);

    await expectAppRoute(page, buildSettingsHostRoute(secondaryServerId));
    await expectSettingsSidebarVisible(page);
    await expectHostSettingsTitle(page, secondaryHostLabel);

    await openSettingsHostSection(page, secondaryServerId, "host");
  });

  test("removing the last active host returns to welcome after settings closes", async ({
    page,
    withWorkspace,
  }) => {
    const workspace = await withWorkspace({ prefix: "remove-host-compact-" });

    await openWorkspace(page, workspace);
    await openCompactSettings(page, buildHostWorkspaceRoute(getServerId(), workspace.workspaceId));
    await openSettingsHostSection(page, getServerId(), "host");
    await removeCurrentHostFromSettings(page);
    await closeCompactSettings(page);

    await expect(page).toHaveURL(/\/welcome$/);
    await expect(page.getByTestId("welcome-direct-connection")).toBeVisible();
  });
});
