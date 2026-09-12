import React, { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CompanionPresence } from "./presence";
import { useCompanionStore } from "./store";
import { MicOrb } from "./mic-orb";
import type { CompanionMicState } from "./store";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock("react-native-reanimated", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-native-reanimated")>()),
  useReducedMotion: () => motion.reduced,
}));
// RN Web replaces looping animations with no-ops under NODE_ENV=test. Exercise its real driver.
vi.mock("react-native", async (importOriginal) => {
  const native = await importOriginal<typeof import("react-native")>();
  const driver = await vi.importActual<{ default: typeof native.Animated }>(
    "react-native-web/dist/vendor/react-native/Animated/AnimatedImplementation",
  );
  return {
    ...native,
    Animated: {
      ...native.Animated,
      timing: driver.default.timing,
      loop: driver.default.loop,
      parallel: driver.default.parallel,
    },
  };
});
let root: Root;
let container: HTMLDivElement;
const onPress = vi.fn();
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  motion.reduced = false;
  onPress.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
function render(node: ReactNode) {
  act(() => root.render(node));
}
function orb(state: CompanionMicState, volume: number, speakingVolume = 0) {
  render(
    <MicOrb
      state={state}
      volume={volume}
      speakingVolume={speakingVolume}
      onPress={onPress}
      accessibilityLabel="Mute"
      testID="orb"
    />,
  );
}
function element(id: string): HTMLElement {
  const node = container.querySelector(`[data-testid="${id}"]`);
  if (!(node instanceof HTMLElement)) throw new Error(`Missing ${id}`);
  return node;
}
function inputScale() {
  return new DOMMatrixReadOnly(getComputedStyle(element("companion-input-level")).transform).a;
}

it.each(["listening", "thinking", "speaking"] as const)(
  "keeps microphone feedback and mute available while %s",
  async (state) => {
    orb(state, 0);
    await expect.poll(inputScale).toBeCloseTo(1, 2);
    orb(state, 0.9);
    await expect.poll(inputScale).toBeGreaterThan(1.12);
    act(() => element("orb").click());
    expect(onPress).toHaveBeenCalledOnce();
    expect(element("orb").getAttribute("aria-busy")).not.toBe("true");
  },
);

it("keeps flowing through silence while thinking", async () => {
  orb("thinking", 0);
  const initial = getComputedStyle(element("companion-orb-flow")).transform;
  await expect
    .poll(() => getComputedStyle(element("companion-orb-flow")).transform)
    .not.toBe(initial);
});

it("stops microphone feedback when muted even if stale levels arrive", async () => {
  orb("thinking", 1);
  await expect.poll(inputScale).toBeGreaterThan(1.1);
  orb("idle", 1, 1);
  await expect.poll(inputScale).toBeCloseTo(1, 2);
  expect(getComputedStyle(element("companion-input-level")).opacity).toBe("0.2");
});

it("honors reduced motion while retaining visible input feedback", async () => {
  motion.reduced = true;
  orb("thinking", 0);
  await expect.poll(() => getComputedStyle(element("companion-input-level")).opacity).toBe("0.7");
  const flow = getComputedStyle(element("companion-orb-flow")).transform;
  orb("thinking", 1);
  await expect.poll(() => getComputedStyle(element("companion-input-level")).opacity).toBe("1");
  expect(inputScale()).toBe(1);
  expect(getComputedStyle(element("companion-orb-flow")).transform).toBe(flow);
});

it("shows Listening alongside Thinking and Speaking, then reports mute and connection loss honestly", () => {
  const state = useCompanionStore.getState();
  act(() => state.sessionStarted());
  render(<CompanionPresence onPress={onPress} />);
  act(() => state.transcriptReceived({ text: "Check the build", isFinal: true }));
  expect(element("companion-mic-state").textContent).toBe("companion.micState.listening");
  expect(element("companion-response-state").textContent).toBe("companion.micState.thinking");
  act(() => state.companionAudioStarted());
  expect(element("companion-mic-state").textContent).toBe("companion.micState.listening");
  expect(element("companion-response-state").textContent).toBe("companion.micState.speaking");
  act(() => state.setMuted(true));
  expect(element("companion-mic-state").textContent).toBe("companion.status.muted");
  expect(element("companion-mic-orb").getAttribute("aria-label")).toBe("companion.actions.unmute");
  act(() => state.sessionReconnecting());
  expect(element("companion-mic-state").textContent).toBe("agentPanel.states.reconnecting");
  act(() => state.sessionStopped());
});
