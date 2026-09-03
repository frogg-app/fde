// Window-drag harness: the real exported UI under headless Chromium with the
// built bridge and a stubbed Tauri runtime (custom Windows chrome). A press on
// the top strip must invoke `plugin:window|start_dragging`; a press on a
// window-control button must not, and the button must still work.
//
// Run with `npm run test:harness` (needs `build:ui`, `build:bridge`, Chromium).

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { invocations, launchChromium, openShellPage, serveDist } from "./harness.support.mjs";

let server;
let browser;
let page;

before(async () => {
  server = await serveDist();
  browser = await launchChromium();
  page = await openShellPage(browser);
  await page.goto(`${server.origin}/`, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-testid=welcome-screen]", { timeout: 30_000 });
});

after(async () => {
  await browser?.close();
  await server?.close();
});

async function resetInvocations() {
  await page.evaluate(() => {
    window.__harnessInvocations.length = 0;
  });
}

async function dragStarts() {
  return (await invocations(page, "plugin:window|start_dragging")).length;
}

async function pressAt(x, y) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
}

async function describePoint(x, y) {
  return page.evaluate(
    ([px, py]) => {
      const element = document.elementFromPoint(px, py);
      const chain = [];
      for (let node = element; node && chain.length < 6; node = node.parentElement) {
        const testId = node.getAttribute("data-testid");
        chain.push(
          `${node.tagName.toLowerCase()}${testId ? `[${testId}]` : ""}` +
            `${node.hasAttribute("data-tauri-drag-region") ? "[drag]" : ""}`,
        );
      }
      return { text: element?.textContent?.trim().slice(0, 40) ?? "", chain: chain.join(" < ") };
    },
    [x, y],
  );
}

/** Centre of the first element matching `selector` inside `root` (a selector too). */
async function centreOf(root, selector) {
  return page.evaluate(
    ([rootSelector, childSelector]) => {
      const element = document.querySelector(rootSelector)?.querySelector(childSelector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    },
    [root, selector],
  );
}

test("landing screen: the top strip drags across the full width", async () => {
  const width = 1280;
  for (const x of [8, 120, width / 2, width - 200]) {
    await resetInvocations();
    const point = await describePoint(x, 18);
    await pressAt(x, 18);
    assert.equal(await dragStarts(), 1, `x=${x}: ${point.chain}`);
  }
});

test("landing screen: a double-click on the strip toggles maximize", async () => {
  await resetInvocations();
  await page.mouse.dblclick(400, 18);
  assert.equal((await invocations(page, "plugin:window|toggle_maximize")).length, 1);
  // The first press starts a drag, the second (detail === 2) toggles instead.
  assert.equal(await dragStarts(), 1);
});

test("window controls: buttons do not drag and still act", async () => {
  const minimize = page.locator("[data-testid=desktop-window-controls] button").first();
  const box = await minimize.boundingBox();
  assert.ok(box, "minimize button is rendered");
  await resetInvocations();
  await pressAt(box.x + box.width / 2, box.y + box.height / 2);
  assert.equal(await dragStarts(), 0, "a window-control press must not start a drag");
  assert.equal((await invocations(page, "plugin:window|minimize")).length, 1);
});

test("landing screen: content below the strip is not a drag surface", async () => {
  const remote = await page.locator("[data-testid=welcome-remote-host]").boundingBox();
  await resetInvocations();
  await pressAt(remote.x + remote.width / 2, remote.y + remote.height / 2);
  assert.equal(await dragStarts(), 0);
});

// The workspace header (`ScreenHeader`, the pane tab row) renders as a marked
// container whose text and controls are siblings of the old overlay, which is
// exactly the shape Tauri's own handler could not drag. Reproduced here as
// DOM because reaching a workspace needs a running daemon.
test("header-shaped surface: text drags, controls and opt-outs do not", async () => {
  await page.evaluate(() => {
    document.getElementById("harness-header")?.remove();
    const header = document.createElement("div");
    header.id = "harness-header";
    header.setAttribute("data-tauri-drag-region", "");
    header.style.cssText =
      "position:fixed;top:60px;left:0;width:900px;height:36px;display:flex;align-items:center;gap:16px;z-index:9999;background:#eee";
    header.innerHTML = `
      <div style="position:absolute;inset:0" data-tauri-drag-region=""></div>
      <div class="text" style="position:relative;padding:0 12px"><span>Workspace title</span></div>
      <button class="button" style="position:relative">Menu</button>
      <div class="role-button" role="button" tabindex="0" style="position:relative;padding:0 8px"><span>Tab</span></div>
      <input class="input" style="position:relative;width:80px" />
      <div class="opt-out" data-tauri-drag-region="false" style="position:relative;padding:0 8px">Resizer</div>
      <div class="css-no-drag" style="position:relative;padding:0 8px;-webkit-app-region:no-drag">Slider</div>
    `;
    document.body.append(header);
  });
  const cases = [
    [".text span", 1, "text inside the header drags"],
    [".button", 0, "a <button> does not drag"],
    [".role-button span", 0, "text inside role=button does not drag"],
    [".input", 0, "an <input> does not drag"],
    [".opt-out", 0, 'data-tauri-drag-region="false" opts out'],
  ];
  for (const [selector, expected, label] of cases) {
    const point = await centreOf("#harness-header", selector);
    assert.ok(point, `${selector} is rendered`);
    await resetInvocations();
    await pressAt(point.x, point.y);
    assert.equal(await dragStarts(), expected, label);
  }
  const noDrag = await centreOf("#harness-header", ".css-no-drag");
  await resetInvocations();
  await pressAt(noDrag.x, noDrag.y);
  const region = await page.evaluate(
    () =>
      getComputedStyle(document.querySelector("#harness-header .css-no-drag")).getPropertyValue(
        "-webkit-app-region",
      ) ||
      getComputedStyle(document.querySelector("#harness-header .css-no-drag")).getPropertyValue(
        "app-region",
      ),
  );
  // Chromium only exposes app-region on computed style in app contexts; when
  // it does, the handler must honour it.
  if (region.trim() === "no-drag") {
    assert.equal(await dragStarts(), 0, "-webkit-app-region: no-drag opts out");
  }
  await page.evaluate(() => document.getElementById("harness-header")?.remove());
});

test("settings modal: its header is not part of the window chrome", async () => {
  await page.click("[data-testid=welcome-open-settings]");
  await page.waitForTimeout(1_000);
  const header = await page.evaluate(() => {
    for (const node of document.querySelectorAll("[data-tauri-drag-region]")) {
      const rect = node.getBoundingClientRect();
      const text = node.textContent?.trim() ?? "";
      if (rect.top > 40 && text.length > 0) {
        return { top: rect.top, text: text.slice(0, 30) };
      }
    }
    return null;
  });
  assert.equal(header, null, "no drag surface below the top edge carries modal text");
  await page.keyboard.press("Escape");
});
