import { expect, test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import {
  expectSidebarItemHidden,
  expectSidebarNavSettingsOrder,
  expectSidebarNavSettingsRow,
  expectSidebarOrder,
  expectStoredSidebarNav,
  leaveSettings,
  moveSidebarNavItemUp,
  openSidebarNavSettings,
  seedSidebarNavPreferences,
  setSidebarNavItemVisible,
} from "../support/helpers/sidebar-nav-settings";

test.describe("Sidebar items in Appearance settings", () => {
  test("owner reorders and hides top-level sidebar items", async ({ page }) => {
    await gotoAppShell(page);

    await test.step("the sidebar starts in the default order", async () => {
      await expectSidebarOrder(page, ["home", "search", "history", "companion"]);
      await expect(page.getByTestId("sidebar-global-new-workspace")).toHaveCount(0);
      await expect(page.getByTestId("sidebar-hosts-trigger")).toHaveCount(0);
      const addProject = page.getByTestId("sidebar-add-project");
      const settings = page.getByTestId("sidebar-settings");
      await expect(addProject).toContainText("Add project");
      await expect(settings).toContainText("Settings");
      const addProjectBox = await addProject.boundingBox();
      const settingsBox = await settings.boundingBox();
      expect(addProjectBox).not.toBeNull();
      expect(settingsBox).not.toBeNull();
      expect(settingsBox!.y).toBeGreaterThanOrEqual(addProjectBox!.y + addProjectBox!.height);
      expect(settingsBox!.x).toBe(addProjectBox!.x);
      expect(settingsBox!.width).toBe(addProjectBox!.width);
      await page.getByTestId("sidebar-home").click();
      await expect(page).toHaveURL(/\/open-project$/);
    });

    await test.step("the Sidebar section lists every item in the same order", async () => {
      await openSidebarNavSettings(page);
      // The section explains itself through the header's info tooltip, not a paragraph.
      await expect(page.getByTestId("sidebar-nav-section-info")).toHaveAccessibleName(
        "About Sidebar",
      );
      await expectSidebarNavSettingsOrder(page, ["home", "search", "history", "companion"]);
      await expectSidebarNavSettingsRow(page, {
        key: "history",
        label: "History",
        visible: true,
      });
      // Items with a keyboard shortcut badge it next to their name. Chords render
      // with Ctrl off macOS, which is what the browser project runs on.
      await expect(
        page.getByTestId("sidebar-nav-item-search").getByText("Ctrl+K", { exact: true }),
      ).toBeVisible();
    });

    await test.step("moving History up lifts it above Search", async () => {
      await moveSidebarNavItemUp(page, "history");
      await expectSidebarNavSettingsOrder(page, ["home", "history", "search", "companion"]);

      await leaveSettings(page);
      await expectSidebarOrder(page, ["home", "history", "search", "companion"]);
    });

    await test.step("turning History off removes it from the sidebar", async () => {
      await openSidebarNavSettings(page);
      await setSidebarNavItemVisible(page, "history", false);
      await expectStoredSidebarNav(page, [
        { key: "home", visible: true },
        { key: "history", visible: false },
        { key: "search", visible: true },
        { key: "companion", visible: true },
      ]);

      await leaveSettings(page);
      await expectSidebarItemHidden(page, "history");
      await expectSidebarOrder(page, ["home", "search", "companion"]);
    });

    await test.step("the sidebar keeps that shape across a reload", async () => {
      await page.reload();
      await expectSidebarItemHidden(page, "history");
      await expectSidebarOrder(page, ["home", "search", "companion"]);
    });
  });

  test("renders no top-level items when every one is turned off", async ({ page }) => {
    await seedSidebarNavPreferences(page, [
      { key: "home", visible: false },
      { key: "history", visible: false },
      { key: "search", visible: false },
      { key: "companion", visible: false },
    ]);
    await gotoAppShell(page);

    // The sidebar itself still renders; only its top-level nav items are gone.
    await expect(page.locator('[data-testid="sidebar-settings"]:visible')).toBeVisible({
      timeout: 30_000,
    });
    await expectSidebarItemHidden(page, "home");
    await expectSidebarItemHidden(page, "history");
    await expectSidebarItemHidden(page, "search");
    await expectSidebarItemHidden(page, "companion");
  });
});
