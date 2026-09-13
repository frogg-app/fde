// Native mobile qualification is separate from the browser WebRTC preview.
export interface CompanionNativeAudio {
  prepare(): Promise<string>;
  connect(sdp: string): Promise<void>;
  mute(muted: boolean): void;
  close(): void;
}
export function createCompanionNativeAudio(
  _onEnded: () => void,
  _onOutputLevel?: (level: number) => void,
): CompanionNativeAudio {
  return {
    async prepare() {
      throw new Error(
        "Native voice preview is currently available on desktop and web. Use local speech on mobile.",
      );
    },
    async connect() {},
    mute() {},
    close() {},
  };
}
