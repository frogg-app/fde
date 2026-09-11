import { isElectronRuntime } from "@/desktop/host";

export interface WebPlayback {
  stop(): void;
  disconnect(): void;
}

export interface WebDecodedAudio {
  duration: number;
  start(onEnded: () => void): WebPlayback;
}

export interface WebCapture {
  disconnect(): void;
}

export interface WebAudioContext {
  resume(): Promise<void>;
  close(): Promise<void>;
  decode(bytes: ArrayBuffer, mimeType: string): Promise<WebDecodedAudio>;
  capture(onSamples: (samples: Float32Array, sampleRate: number) => void): Promise<WebCapture>;
}

export interface WebAudioResources {
  createContext(): WebAudioContext;
}

export const browserAudioResources: WebAudioResources = {
  createContext() {
    const browserWindow = window as typeof window & {
      webkitAudioContext?: typeof AudioContext;
    };
    const Context = browserWindow.AudioContext ?? browserWindow.webkitAudioContext;
    if (!Context) throw new Error("AudioContext unavailable");
    const context = new Context();
    return {
      async resume() {
        if (context.state === "suspended") await context.resume();
      },
      async close() {
        if (context.state !== "closed") await context.close();
      },
      async decode(bytes, mimeType) {
        let buffer: AudioBuffer;
        if (mimeType.toLowerCase().startsWith("audio/pcm")) {
          const match = /rate=(\d+)/i.exec(mimeType);
          const parsedRate = match ? Number(match[1]) : 24000;
          const sampleRate = Number.isFinite(parsedRate) && parsedRate > 0 ? parsedRate : 24000;
          const input = new DataView(bytes);
          buffer = context.createBuffer(1, Math.floor(bytes.byteLength / 2), sampleRate);
          const channel = buffer.getChannelData(0);
          for (let i = 0; i < channel.length; i++)
            channel[i] = input.getInt16(i * 2, true) / 0x8000;
        } else {
          // Callback overload works with both older WebKit and current promise implementations.
          buffer = await new Promise<AudioBuffer>((resolve, reject) => {
            const decoding = context.decodeAudioData(bytes.slice(0), resolve, reject);
            if (decoding) void decoding.catch(reject);
          });
        }
        return {
          duration: buffer.duration,
          start(onEnded) {
            const source = context.createBufferSource();
            source.buffer = buffer;
            source.addEventListener("ended", onEnded);
            source.connect(context.destination);
            function disconnect() {
              source.removeEventListener("ended", onEnded);
              source.disconnect();
              source.buffer = null;
            }
            try {
              source.start();
            } catch (error) {
              disconnect();
              throw error;
            }
            return { stop: () => source.stop(), disconnect };
          },
        };
      },
      async capture(onSamples) {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("Microphone capture is not supported in this environment");
        }
        if (!window.isSecureContext && !isElectronRuntime()) {
          throw new Error(
            `Microphone access requires HTTPS or localhost. Current origin: ${window.location.origin}`,
          );
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            noiseSuppression: true,
            echoCancellation: true,
            autoGainControl: true,
          },
        });
        let source: MediaStreamAudioSourceNode | null = null;
        let processor: ScriptProcessorNode | null = null;
        let gain: GainNode | null = null;
        function disconnect() {
          if (processor) processor.onaudioprocess = null;
          for (const node of [processor, source, gain]) node?.disconnect();
          for (const track of stream.getTracks()) track.stop();
        }
        try {
          source = context.createMediaStreamSource(stream);
          processor = context.createScriptProcessor(4096, 1, 1);
          gain = context.createGain();
          gain.gain.value = 0;
          processor.onaudioprocess = (event) => {
            onSamples(event.inputBuffer.getChannelData(0), context.sampleRate);
          };
          source.connect(processor);
          processor.connect(gain);
          gain.connect(context.destination);
          return { disconnect };
        } catch (error) {
          disconnect();
          throw error;
        }
      },
    };
  },
};
