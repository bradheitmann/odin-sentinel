import { describe, expect, it } from "vitest";
import { getActiveWatchPacket, getStartupPacket } from "../../src/protocol/service.js";

describe("ODIN active watch packets", () => {
  it("gives ODIN roles ACTIVE_WATCH prompts by default", () => {
    const packet = getActiveWatchPacket({ role: "A/EXEC-ODIN" }) as {
      state: string;
      promptText: string;
      pollIntervalSeconds: number;
      terminalStates: string[];
      classifications: string[];
      authority: { mayImplement: boolean; mayQaAccept: boolean };
    };

    expect(packet.state).toBe("ACTIVE_WATCH");
    expect(packet.pollIntervalSeconds).toBe(30);
    expect(packet.terminalStates).toEqual(["RELEASED_BY_OPERATOR", "HANDED_OFF", "PARKED_IDLE", "FAILED", "WATCH_UNSUPPORTED"]);
    expect(packet.classifications).toEqual(
      expect.arrayContaining(["BLOCKED_BY_PERMISSION", "BLOCKED_BY_AUTH", "BLOCKED_BY_LOGIN", "BLOCKED_BY_API_KEY", "MODEL_STALLED", "STREAMING_PROTOCOL_MISMATCH"])
    );
    expect(packet.authority).toMatchObject({ mayImplement: false, mayQaAccept: false });
    expect(packet.promptText).toContain("Poll every 30 seconds");
    expect(packet.promptText).toContain("A turn ending without re-arming");
  });

  it("keeps non-ODIN roles out of ODIN watch authority", () => {
    const packet = getActiveWatchPacket({ role: "B/DEV-1" }) as {
      state: string;
      mayIntervene: boolean;
      promptText: string;
    };

    expect(packet.state).toBe("WATCH_UNSUPPORTED");
    expect(packet.mayIntervene).toBe(false);
    expect(packet.promptText).toContain("not an ODIN role");
  });

  it("derives watch targets from manifest role slots", () => {
    const packet = getActiveWatchPacket({
      role: "B/ODIN",
      manifest: {
        role_slots: [
          { role_slot: "B/ODIN", watches: ["B/TEAM-PM", "B/DEV-1", "B/QA-1"] }
        ]
      }
    }) as { targets: string[] };

    expect(packet.targets).toEqual(["B/TEAM-PM", "B/DEV-1", "B/QA-1"]);
  });

  it("includes plan-mode carve-out text when requested", () => {
    const packet = getActiveWatchPacket({ role: "A/EXEC-ODIN", planMode: true }) as { promptText: string };

    expect(packet.promptText).toContain("Plan-mode/read-only carve-out");
  });

  it("injects active-watch language into ODIN startup packets", () => {
    const packet = getStartupPacket({ role: "A/EXEC-ODIN" });

    expect(packet.activeWatch).toMatchObject({ state: "ACTIVE_WATCH" });
    expect(packet.startupPrompt).toContain("ACTIVE_WATCH");
  });
});
