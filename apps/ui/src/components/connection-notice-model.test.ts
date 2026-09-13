import { describe, expect, it } from "vitest";
import {
  formatOfflineDuration,
  reconcileConnectionNotices,
  type ConnectionNotice,
  type ConnectionNoticeHostInput,
} from "./connection-notice-model";

function host(
  status: ConnectionNoticeHostInput["status"],
  statusSince = 0,
): ConnectionNoticeHostInput {
  return { serverId: "s1", label: "Home", status, statusSince };
}

describe("reconcileConnectionNotices", () => {
  it("ignores hosts that were never online", () => {
    const seenOnline = new Set<string>();
    expect(
      reconcileConnectionNotices({
        previous: [],
        hosts: [host("offline")],
        seenOnline,
        now: 5_000,
      }),
    ).toEqual([]);
  });

  it("walks offline, then reconnected, then clears", () => {
    const seenOnline = new Set<string>();
    let notices: ConnectionNotice[] = reconcileConnectionNotices({
      previous: [],
      hosts: [host("online")],
      seenOnline,
      now: 0,
    });
    expect(notices).toEqual([]);

    notices = reconcileConnectionNotices({
      previous: notices,
      hosts: [host("connecting", 1_000)],
      seenOnline,
      now: 1_000,
    });
    expect(notices).toMatchObject([{ kind: "offline", since: 1_000, showAt: 2_000 }]);

    notices = reconcileConnectionNotices({
      previous: notices,
      hosts: [host("online")],
      seenOnline,
      now: 5_000,
    });
    expect(notices).toMatchObject([{ kind: "reconnected", since: 5_000 }]);

    notices = reconcileConnectionNotices({
      previous: notices,
      hosts: [host("online")],
      seenOnline,
      now: 9_000,
    });
    expect(notices).toEqual([]);
  });

  it("does not confirm a reconnect for a blip that never became visible", () => {
    const seenOnline = new Set(["s1"]);
    const offline = reconcileConnectionNotices({
      previous: [],
      hosts: [host("connecting", 1_000)],
      seenOnline,
      now: 1_000,
    });
    expect(
      reconcileConnectionNotices({
        previous: offline,
        hosts: [host("online")],
        seenOnline,
        now: 1_400,
      }),
    ).toEqual([]);
  });
});

describe("formatOfflineDuration", () => {
  it("formats seconds and minutes", () => {
    expect(formatOfflineDuration(12_400)).toBe("12s");
    expect(formatOfflineDuration(120_000)).toBe("2m");
    expect(formatOfflineDuration(125_000)).toBe("2m 5s");
  });
});
