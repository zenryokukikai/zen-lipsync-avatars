# Third-party notices

The avatar materials, the models, the demo and the examples are made by Zenryoku Kikai Inc.,
except for the third-party parts of examples/conversation listed below.

## examples/conversation

- **Silero VAD** (`examples/conversation/asr/silero_vad.wgw`: the weights of silero_vad.onnx in a flat file; the voice
  activity detector in `asr/vad.ts` is our own TypeScript code). MIT License, Copyright (c) 2020-present Silero Team.
  https://github.com/snakers4/silero-vad

  > Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
  > documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
  > rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit
  > persons to whom the Software is furnished to do so, subject to the following conditions:
  >
  > The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
  > Software.
  >
  > THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
  > WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
  > COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
  > OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

- **reazonspeech-k2-v2** (ReazonSpeech, Reazon Holdings, Inc.): the Japanese speech recognition model used by
  `examples/conversation`. Apache License 2.0. https://huggingface.co/reazon-research/reazonspeech-k2-v2
  (revision 291488c8151be24d7da4bf7af26e533fad96e407)
  - Not included in this repository. It is distributed as the assets of the GitHub release
    [asr-k2v2-webgpu-1](https://github.com/zenryokukikai/zen-lipsync-avatars/releases/tag/asr-k2v2-webgpu-1)
    (with `LICENSE-Apache-2.0.txt` and `SHA256SUMS`); `pnpm fetch-asr` downloads it into `examples/conversation/asr/model/`
    and checks each SHA-256.
  - **Modification notice (Apache-2.0 Section 4(b))**: 「WebGPU 用に形式を変換（値は同じ）」 — the int8 weights of the
    upstream ONNX files (encoder / decoder / joiner) were converted to a WebGPU weight format (model.json / model.wgq /
    stack0–5.wgq); values unchanged. Converted by Zenryoku Kikai Inc.
  - The recognizer in `asr/recognizer.ts`, `asr/wgsl-stack.ts`, `asr/fbank.ts` is our own WebGPU / TypeScript code.
  - These weights stay under Apache-2.0 (not the ZEN-LipSync License). A copy of the Apache License 2.0 is attached to
    the release and at https://www.apache.org/licenses/LICENSE-2.0

## Runtime dependency

- `@zenryokukikai/zen-lipsync` (the ZEN-LipSync SDK, ZEN-LipSync License): see its THIRD_PARTY_NOTICES.md.
- `zen-tts` (ZEN-TTS, ZEN-TTS License; examples/conversation): see its THIRD_PARTY_NOTICES.md. Its models (`pnpm fetch-tts-models`) are not committed here.

## Bundled into dist/ by `pnpm build` (not committed)

- React and React DOM (MIT, Copyright (c) Meta Platforms, Inc. and affiliates) — only in the React example's bundle.

## Development tools (not distributed)

- esbuild (MIT), TypeScript (Apache-2.0) and Playwright (Apache-2.0) are development dependencies only.
