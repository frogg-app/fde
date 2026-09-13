# Optional local speech model notices

FDE downloads speech models separately; their data/model/component terms are
independent of FDE's Apache-2.0 source license. Preserve upstream files and notices
when packaging or redistributing a model directory.

## Piper LJSpeech medium

- Voice: `en_US-ljspeech-medium`, Sherpa VITS/Piper conversion.
- [Sherpa package and usage](https://k2-fsa.github.io/sherpa/onnx/tts/all/English/vits-piper-en_US-ljspeech-medium.html).
- [Upstream model card](https://huggingface.co/rhasspy/piper-voices/blob/main/en/en_US/ljspeech/medium/MODEL_CARD): English LJSpeech dataset, identified as public domain.
- [Piper voices repository](https://huggingface.co/rhasspy/piper-voices): repository metadata declares MIT. This does not relicense separately included components.
- The package includes `espeak-ng-data`. eSpeak NG has its own GPL licensing;
  retain its attribution and applicable source/license obligations when
  redistributing. See [eSpeak NG licensing](https://github.com/espeak-ng/espeak-ng/blob/master/COPYING).

The approximately 67 MB archive is downloaded from the existing Sherpa release
hosting workflow. FDE's catalog requires the model, tokens and phonemizer data and
does not remove accompanying upstream notices during extraction. Kokoro remains
an optional configured voice with its existing model distribution terms.

## Kitten nano 0.8 FP32 and Kokoro 1.0 INT8

- Default: [Kitten nano 0.8 FP32](https://huggingface.co/KittenML/kitten-tts-nano-0.8-fp32),
  Rosie (speaker 5). Model licensing: Apache-2.0. Sherpa archive approximately 61 MiB.
- Optional: [Kokoro 82M](https://huggingface.co/hexgrad/Kokoro-82M), v1.0 INT8
  Sherpa conversion. Model licensing: Apache-2.0. Archive approximately 126 MiB.
- Both catalog entries require the included `LICENSE` file and preserve archive
  contents. Their `espeak-ng-data` has separate eSpeak NG terms as linked above;
  model licensing does not replace phonemizer obligations.
