import { once } from "node:events";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { OpenAISTT } from "./stt.js";
import { OpenAITTS } from "./tts.js";

const logger = pino({ level: "silent" });
const config = { apiKey: "test-only", baseUrl: "https://speech.example.test/v1" };

describe("OpenAI SDK speech transport compatibility", () => {
  it("sends configured speech requests and returns a consumable Node audio stream", async () => {
    const requests: Request[] = [];
    const provider = new OpenAITTS(config, logger, {
      fetch: async (input, init) => {
        requests.push(new Request(input, init));
        return new Response(new Uint8Array([1, 2, 3, 4]));
      },
      maxRetries: 0,
    });
    const result = await provider.synthesizeSpeech("Hello from Frogg");
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("https://speech.example.test/v1/audio/speech");
    expect(requests[0].headers.get("authorization")).toBe("Bearer test-only");
    expect(await requests[0].json()).toEqual({
      model: "tts-1",
      voice: "alloy",
      input: "Hello from Frogg",
      response_format: "pcm",
    });
    const chunks: Buffer[] = [];
    for await (const chunk of result.stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks)).toEqual(Buffer.from([1, 2, 3, 4]));
    expect(result.format).toBe("pcm");
  });

  it("cancels the SDK response body when playback destroys its Node stream", async () => {
    let canceled = false;
    const provider = new OpenAITTS(config, logger, {
      fetch: async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            cancel() {
              canceled = true;
            },
          }),
        ),
      maxRetries: 0,
    });
    const { stream } = await provider.synthesizeSpeech("Cancel this reply");
    const closed = once(stream, "close");
    stream.destroy();
    await closed;
    expect(canceled).toBe(true);
  });

  it("uploads dictation WAV through the SDK multipart encoder and reads confidence", async () => {
    const forms: FormData[] = [];
    const urls: string[] = [];
    const provider = new OpenAISTT({ ...config, model: "gpt-4o-transcribe" }, logger, {
      fetch: async (input, init) => {
        const request = new Request(input, init);
        urls.push(request.url);
        forms.push(await request.formData());
        return Response.json({
          text: "Ship it",
          language: "en",
          logprobs: [{ token: "Ship", logprob: -0.25 }],
        });
      },
      maxRetries: 0,
    });
    const session = provider.createSession({
      logger,
      language: "en",
      prompt: "Only transcribe speech",
    });
    const transcript = new Promise<unknown>((resolve, reject) => {
      session.on("transcript", (event) => {
        if (event.isFinal) resolve(event);
      });
      session.on("error", reject);
    });
    try {
      await session.connect();
      session.appendPcm16(Buffer.from([0, 0, 1, 0]));
      session.commit();
      await expect(transcript).resolves.toMatchObject({
        transcript: "Ship it",
        isFinal: true,
        avgLogprob: -0.25,
        isLowConfidence: false,
      });
      expect(urls).toEqual(["https://speech.example.test/v1/audio/transcriptions"]);
      expect(forms[0].get("model")).toBe("gpt-4o-transcribe");
      expect(forms[0].get("language")).toBe("en");
      expect(forms[0].get("prompt")).toBe("Only transcribe speech");
      expect(forms[0].get("include[]")).toBe("logprobs");
      const file = forms[0].get("file");
      expect(file).toBeInstanceOf(File);
      if (!(file instanceof File)) throw new Error("Expected uploaded audio file");
      expect(file.name).toMatch(/\.wav$/);
      expect(
        Buffer.from(await file.arrayBuffer())
          .subarray(0, 4)
          .toString(),
      ).toBe("RIFF");
    } finally {
      session.close();
    }
  });
});
