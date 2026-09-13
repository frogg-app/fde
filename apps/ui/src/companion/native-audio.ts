import { acquireAudio, releaseAudio } from "@/voice/audio-ownership";
export interface CompanionNativeAudio {
  prepare(): Promise<string>;
  connect(sdp: string): Promise<void>;
  mute(muted: boolean): void;
  close(): void;
}

export function createCompanionNativeAudio(
  onEnded: () => void,
  onOutputLevel?: (level: number) => void,
): CompanionNativeAudio {
  const owner = Symbol("companion-native-voice");
  let peer: RTCPeerConnection | null = null;
  let capture: MediaStream | null = null;
  let audio: HTMLAudioElement | null = null;
  let closed = false;
  let rejectConnection: (() => void) | null = null;
  let meter: ReturnType<typeof setInterval> | undefined;
  let audioContext: AudioContext | null = null;
  return {
    async prepare() {
      acquireAudio(owner);
      if (typeof RTCPeerConnection === "undefined" || !navigator.mediaDevices?.getUserMedia)
        throw new Error("Native voice requires WebRTC and microphone access.");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (closed) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error("Conversation closed");
      }
      capture = stream;
      peer = new RTCPeerConnection();
      for (const track of stream.getAudioTracks()) {
        peer.addTrack(track, stream);
        track.addEventListener("ended", onEnded);
      }
      peer.createDataChannel("oai-events");
      audio = document.createElement("audio");
      audio.autoplay = true;
      peer.ontrack = (event) => {
        if (onOutputLevel && !audioContext) {
          audioContext = new AudioContext();
          const source = audioContext.createMediaStreamSource(event.streams[0]);
          const analyser = audioContext.createAnalyser();
          const silent = audioContext.createGain();
          silent.gain.value = 0;
          source.connect(analyser).connect(silent).connect(audioContext.destination);
          const samples = new Float32Array(analyser.fftSize);
          meter = setInterval(() => {
            analyser.getFloatTimeDomainData(samples);
            let energy = 0;
            for (const sample of samples) energy += sample * sample;
            onOutputLevel(Math.min(1, Math.sqrt(energy / samples.length) * 4));
          }, 50);
        }
        if (audio) {
          audio.srcObject = event.streams[0];
          void audio.play().catch(onEnded);
        }
      };
      peer.onconnectionstatechange = () => {
        if (peer?.connectionState === "failed" || peer?.connectionState === "disconnected")
          onEnded();
      };
      await peer.setLocalDescription(await peer.createOffer());
      return peer.localDescription!.sdp;
    },
    async connect(sdp) {
      if (!peer || closed) throw new Error("Conversation closed");
      await peer.setRemoteDescription({ type: "answer", sdp });
      const connection = peer;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error("Voice connection timed out"));
        }, 20000);
        const changed = () => {
          if (connection.connectionState === "connected") {
            cleanup();
            resolve();
          } else if (["failed", "closed"].includes(connection.connectionState)) {
            cleanup();
            reject(new Error("Voice connection failed"));
          }
        };
        const cleanup = () => {
          clearTimeout(timer);
          rejectConnection = null;
          connection.removeEventListener("connectionstatechange", changed);
        };
        rejectConnection = () => {
          cleanup();
          reject(new Error("Conversation closed"));
        };
        connection.addEventListener("connectionstatechange", changed);
        changed();
      });
    },
    mute(muted) {
      capture?.getAudioTracks().forEach((track) => {
        track.enabled = !muted;
      });
    },
    close() {
      closed = true;
      rejectConnection?.();
      clearInterval(meter);
      void audioContext?.close();
      audioContext = null;
      releaseAudio(owner);
      capture?.getTracks().forEach((track) => {
        track.removeEventListener("ended", onEnded);
        track.stop();
      });
      capture = null;
      if (peer) {
        peer.onconnectionstatechange = null;
        peer.close();
        peer = null;
      }
      if (audio) {
        audio.pause();
        audio.srcObject = null;
        audio = null;
      }
    },
  };
}
