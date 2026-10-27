# ZEN-LipSync のアバター（全力 マリン / 全力 ハシロウ / 全力 キッカ）
<img width="300" alt="image" src="https://github.com/user-attachments/assets/bfe01e0b-68a2-44ac-85f7-170ff24335a2" />
<img width="300" alt="image" src="https://github.com/user-attachments/assets/29b9512e-89f3-4926-83c7-3dccc5740282" />
<img width="300" alt="image" src="https://github.com/user-attachments/assets/d717cb7b-9aa1-48f5-915e-aa583e22f775" />

超軽量で超高速な実写リップシンク「ZEN-LipSync」の、アバターです。音声に合わせて、全力 マリン（ぜんりょく まりん）、全力 ハシロウ（ぜんりょく はしろう）、全力 キッカ（ぜんりょく きっか）をリアルタイムにリップシンクできます。

バージョン 1.0.0（アバターのモデル marine-1.0 / hashiro-1.0 / kikka-1.0）。

> **ZEN-LipSync は、同梱のアバター（全力 マリン／全力 ハシロウ／全力 キッカ）専用のリップシンクモデルです。** 汎用モデルではなく、ほかの顔・映像では動きません。新しいアバターのモデル作成は、全力機械にご依頼ください（https://zenryokukikai.com ）。

> **ご利用にあたっては、クレジットの表示が必須です。** アプリ・サイト・作品の、利用者が見つけられる場所に「リップシンク：ZEN-LipSync（https://zenryokukikai.com ）」を表示してください。URL はリンクにします。ZEN-TTS と組み合わせるときは、「音声合成：ZEN-TTS / リップシンク：ZEN-LipSync（https://zenryokukikai.com ）」のように 1 行にまとめて構いません（詳しくは [LICENSE.md](LICENSE.md) の 3 章）。

## 関連リポジトリ

| リポジトリ | 中身 |
|---|---|
| [zenryokukikai/zen-lipsync-avatars](https://github.com/zenryokukikai/zen-lipsync-avatars)（このリポジトリ） | アバター「全力 マリン」「全力 ハシロウ」「全力 キッカ」のモデルと素材、デモ、使い方の例 |
| [zenryokukikai/zen-lipsync](https://github.com/zenryokukikai/zen-lipsync) | ZEN-LipSync の SDK（`@zenryokukikai/zen-lipsync`） |
| [zenryokukikai/zen-tts](https://github.com/zenryokukikai/zen-tts) | ZEN-TTS 本体：4 人分の声のモデル、ブラウザ用と Node 用の実行部分 |

GitHub のリポジトリを指定して入れます（`v1.0.0` のタグで固定）。

```sh
npm i github:zenryokukikai/zen-lipsync-avatars#v1.0.0
npm i github:zenryokukikai/zen-lipsync#v1.0.0
```

## 入れ方

**npm レジストリには公開していません。GitHub のリポジトリを指定して入れてください。**

```sh
# npm
npm i github:zenryokukikai/zen-lipsync-avatars#v1.0.0
# pnpm
pnpm add github:zenryokukikai/zen-lipsync-avatars#v1.0.0
# yarn
yarn add github:zenryokukikai/zen-lipsync-avatars#v1.0.0
```

- このリポジトリは、アバターの素材と例の集まりです。ふつうは、リポジトリを取ってきて、`pnpm install` で開発用の道具を入れます（下の「動かす」）。
- リポジトリの中の SDK は、決まったコミットで固定しています（`package.json` の `github:zenryokukikai/zen-lipsync#<コミット>`）。このコミットは SDK の 1.0.0 のもので、タグ `v1.0.0` と同じ中身です（README だけが違います）。
- 使う Node.js は 26.12.1 です（`.mise.toml` で固定）。
- 音声合成のモデルは、`pnpm fetch-tts-models` で取ってきます（下のとおり）。

## 入っているもの

このリポジトリには、次のものが入っています。動かすしくみ（SDK）は npm パッケージ [`@zenryokukikai/zen-lipsync`](https://github.com/zenryokukikai/zen-lipsync) です。

この公開版に入っているアバターは、次の 3 人です。

| アバター | id | モデル | 中身 | 大きさ |
|---|---|---|---|---|
| 全力 マリン（Zenryoku Marine） | `marine` | marine-1.0 | モデル（int8 のフレームモデル 2.7 MB、文モデル 11.8 MB）と素材（待機映像 2 種・口元の画像・特徴データ）、試し用の音声 | 84 MB |
| 全力 ハシロウ（Zenryoku Hashiro） | `hashiro` | hashiro-1.0 | モデル（int8 のフレームモデル 2.7 MB、文モデル 11.8 MB）と素材（待機映像 2 種・口元の画像・特徴データ） | 95 MB |
| 全力 キッカ（Zenryoku Kikka） | `kikka` | kikka-1.0 | モデル（int8 のフレームモデル 2.7 MB、文モデル 11.8 MB）と素材（待機映像 1 種・口元の画像・特徴データ） | 56 MB |

- `avatars/marine/`、`avatars/hashiro/`、`avatars/kikka/`：それぞれのアバターのリップシンクのモデルと素材です。
  - 待機映像は、マリンとハシロウが 2 種類（ふつう `normal/` と怒り `angry/`）、キッカが 1 種類（`normal/`）です。話していない間に、似たフレームを選んで 0.3 秒で切り替えられます（`setIdle`）。
  - モデルはどちらの待機映像でも共通です（`models/`）。
  - `avatars/marine/normal/sample.wav`：試し用の音声（ZEN-TTS で作ったマリンの声、約 8 秒）。ハシロウのパックには試し用の音声は入っていないので、計測などでは音声ファイルを指定してください。
- `demo/`：デモのページ（試し用の音声・音声ファイル・録音・少しずつ届く音声・待機映像の切り替え）
- `examples/vanilla/`、`examples/react/`：SDK のいちばん小さい使い方
- `examples/conversation/`：ブラウザだけでリアルタイムに会話するサンプル（声の聞き取り → 返事 → ZEN-TTS の声 → マリンのリップシンク。下の「会話のサンプル」）

このリポジトリには、モデルを作る手段は含まれていません（新しいアバターのご依頼は上のとおりです）。

## デモ

```bash
pnpm install         # SDK（GitHub から）と、開発用の道具
pnpm build           # demo と examples を dist/ にまとめる
pnpm serve           # http://localhost:8080/demo/ をブラウザで開く
```

- 例：`http://localhost:8080/examples/vanilla/`、`http://localhost:8080/examples/react/`
- 素材を別の場所（CDN など）に置くときは、デモに `?assets=<素材の URL>` を付けます。SDK では `create({ assetsBaseUrl, avatar: 'avatars/marine/avatar.json' })` です。
- 動作するブラウザ：WebGPU が使えるもの（Chrome / Edge 113 以降、Safari 26 以降、Android の Chrome など）。WebGPU がないときは `WebGPUUnavailableError` になります。

確認（ヘッドレス Chromium・WebGPU、`pnpm serve` を動かした状態で）：`pnpm check`。試し用の音声で話す、少しずつ届く音声（`speakStream`）、待機映像の切り替え、`create`／`destroy` を 3 回、WebGPU なしで `WebGPUUnavailableError`、例 2 つ、外部への通信なし、を確かめます。

少しずつ届く音声（`speakStream`）は、今の音声が流れている間に次の音声の準備をして、前の音声の終わりにすき間なくつなげて話します（確認：5 つに分けた試し用の音声で、つなぎ目のすき間 0 ms）。

パッケージは pnpm で入れます。サプライチェーン攻撃を避けるため、公開されてから 7 日たっていない版は入れない設定にしています（`pnpm-workspace.yaml` の `minimumReleaseAge`）。

SDK は npm レジストリを使わず、GitHub の決まったコミットから入れています（`package.json` の `github:zenryokukikai/zen-lipsync#<コミット>`）。SDK は入れるときに自分でビルドするので、`pnpm-workspace.yaml` の `allowBuilds` に同じコミットを書いています。コミットを変えるときは、両方を変えてください。npm に公開されたら、`"@zenryokukikai/zen-lipsync": "^0.1.0"` に置き換えます。

## サーバー（Node.js）で使う

`@zenryokukikai/zen-lipsync/node` は、サーバーの CPU で、音声から全力 マリンが話す映像を作ります（GPU は使いません）。Node 20 以降と **ffmpeg**（`PATH` にあるもの）が必要です。linux-x64 では、SDK のネイティブ版を作ると速くなります（SDK の `pnpm run build:native`。gcc が必要）。作らなくても WebAssembly 版で動きます。

```bash
pnpm install
pnpm node:mp4 [音声.wav] [出力.mp4]     # WAV → MP4（examples/node-mp4/）
pnpm node:stream [ポート]                # WebSocket で配信して、ブラウザで見る（examples/node-stream/）
pnpm fetch-tts-models && pnpm node:tts ["文章"] [出力.mp4] [--emotion happy]   # 文章 → マリンが話す MP4（examples/node-tts/）
```

- **examples/node-mp4/**：WAV ファイル（16 bit PCM か 32 bit float）を読み、`avatar.render(audio, { out: 'marine.mp4' })` で MP4（H.264 + AAC）を書き出します。8.12 秒の試し用の音声で、映像も音声も 8.12 秒ちょうど（203 フレーム）になります。
- **examples/node-stream/**：`server.mjs` が、つないだブラウザごとにアバターを作り、`avatar.stream(音声, { format: 'jpeg', realtime: true })` の JPEG と PCM を WebSocket で送ります。`viewer.html` は、届いた音声を順に鳴らし、その時刻に合わせて JPEG を描きます（0.3 秒のゆとり）。「話させる」を押すと、試し用の音声を 1 秒ずつのかたまりで送ります（音声合成が少しずつ返す形のかわり）。話していない間も、待機映像が流れ続けます。`examples/node-stream/check.mjs` で、画面のないブラウザで確かめられます。WebSocket には `ws` パッケージを使います。
- **examples/node-tts/**：文章から、マリンが話す MP4 を作ります。声は ZEN-TTS（`zen-tts/node`、CPU）で 1 文ずつ作り、`renderText(avatar, tts, 文章, { out })`（`@zenryokukikai/zen-lipsync/tts/node`）で、できた文から順にリップシンクします。GPU は使いません。ZEN-TTS のモデルは `pnpm fetch-tts-models` で取ってきます。ZEN-TTS も、linux-x64 ではネイティブ版を作ると速くなります（ZEN-TTS の `pnpm run build:native`。clang 16 以降）。3 文・約 8 秒の文章で、映像も音声も 8.4 秒（あとの待機 0.4 秒を含む）、声のずれは 0 ms でした（CPU 1 本：声とリップシンクの計算で約 7 秒。2 本なら約 5.3 秒）。
- 速さ（Intel Xeon Silver 4316、CPU 1 本）：ネイティブ AVX-512 VNNI 版で約 40 フレーム/秒（実時間の 0.62 倍の時間で作れます）。AVX2／WebAssembly 版は約 20 フレーム/秒です。くわしくは SDK の README を見てください。

## 会話のサンプル（examples/conversation）

マイクに話しかけると、マリンが声で答えます。声の聞き取り・返事の声・リップシンクは、すべてブラウザの中（WebGPU）で動きます。

```bash
pnpm install
pnpm fetch-asr          # 声の聞き取りのモデル（約 155 MB）を examples/conversation/asr/model/ に取ってくる
pnpm fetch-tts-models   # ZEN-TTS のモデル（約 31 MB）を examples/conversation/tts-models/ に取ってくる
pnpm build
pnpm serve              # http://localhost:8080/examples/conversation/ を開いて「会話を始める」
```

- **流れ**：聞く → 話し終わる → 聞き取り → 返事を作る → マリンが最後まで話す → また聞く。マリンが話している間は、マイクを聞きません（自分の声を拾わないため）。
- **声の聞き取り**：ReazonSpeech の「reazonspeech-k2-v2」（Apache-2.0）を WebGPU で動かします。1 回に約 15 秒までです（それより長いと、14 秒で区切ります）。話し声の検出は Silero VAD（MIT）です。どちらも [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) を見てください。モデルはこのリポジトリに入っていません。`pnpm fetch-asr` で、このリポジトリのリリース [asr-k2v2-webgpu-1](https://github.com/zenryokukikai/zen-lipsync-avatars/releases/tag/asr-k2v2-webgpu-1) から取ってきます（Apache-2.0。WebGPU 用に形式を変換しています。値は同じです）。このリポジトリが非公開のあいだは、読み取りできる GitHub のトークンを `GITHUB_TOKEN` に入れてから実行してください（例：`GITHUB_TOKEN=$(gh auth token) pnpm fetch-asr`）。
- **返事を作る AI**：最初は通信しない「おうむ返し」です（キーなしで動きます）。「返事を作る AI の設定」で、OpenAI 互換の API（URL・API キー・モデル名）に切り替えられます。**API キーはこのブラウザの中（localStorage）にだけ保存し、会話の文章と一緒に、このブラウザから指定した URL へ直接送ります。** キーはリポジトリには入っていません。
- **声の感情**：平静・喜び・悲しみ・怒り・申し訳なさから選べます。
- **話させ方**：返事の文章は `speakText(avatar, tts, 文章, { emotion })`（`@zenryokukikai/zen-lipsync/tts`）で話させています。1 文ずつ ZEN-TTS で作り、できた文から順にリップシンクします。文と文の間にすき間はできません。
- **画面の表示**：「音声合成：ZEN-TTS / リップシンク：ZEN-LipSync（https://zenryokukikai.com ）」を、いつも画面の下に表示しています。このサンプルをもとに作るときも、この表示（リンク）を残してください（必須です）。
- **モデルの場所**：`?asrmodel=<URL>`、`?ttsmodels=<URL>`、`?assets=<URL>` で、別の場所（CDN など）から読み込めます。
- 確認（ヘッドレス Chromium・WebGPU、`pnpm serve` を動かした状態で）：`pnpm check:conversation`。話し声の入った WAV を偽のマイクにして、聞き取り → おうむ返し → 声とリップシンク、話している間のマイクを無視すること、画面下の表示とリンク、外部への通信なし、を確かめます。
- ZEN-TTS とのつなぎの確認：`pnpm check:tts`（ブラウザ。3 文の文章を `speakText` で話させて、最初の声とリップシンクまでの時間、文と文の間のすき間、リップシンクが出ているフレームの割合を測ります）、`pnpm check:node-tts`（Node。文章 → MP4 の長さと声のずれ、配信の最初のフレームまでの時間、速さ）。
- **リップシンクだけの速さ**：`pnpm bench:lipsync [WAV]`（Node。音声合成を使わず、WAV をそのままリップシンクに流して、1 フレームの時間、毎秒のフレーム数、最初のフレームまでの時間、RTF を出します。1 コアに固定するときは `taskset -c 0` を付けます）。

## 使い方

```ts
import { create } from '@zenryokukikai/zen-lipsync';

const avatar = await create({
  container: document.getElementById('avatar')!,
  assetsBaseUrl: 'https://example.com/zen-lipsync-avatars/',   // このリポジトリのファイルを置いた場所
  avatar: 'avatars/marine/avatar.json',
});
await avatar.speak({ pcm, sampleRate: 44100 });   // モノラル Float32Array
await avatar.setIdle('angry');
```

ページ側にアバター用の CSS は要りません（`<div id="avatar"></div>` だけで、SDK が映像の縦横比で枠を作り、リップシンクを顔に合わせます）。API の全体は [SDK の README](https://github.com/zenryokukikai/zen-lipsync) にあります。

## 速さ

| 環境 | 1 フレームの推論時間 |
|---|---|
| Intel Xeon Silver 4316、CPU 1 スレッド、ネイティブ（AVX-512 VNNI） | 2.85 ms（音声特徴を含む。フレームモデルだけなら 2.65 ms） |
| iPhone Air、Safari、WebGPU | 約 6.9 ms（約 146 fps） |
| iPhone 16 Pro、Safari、WebGPU | 約 131 fps |
| Pixel 9、Chrome、WebGPU | 約 61 fps |
| MacBook Pro（M3 Max）、ブラウザ、WebGPU | 約 1,060 fps |

## ライセンス

**ZEN-LipSync ライセンス**（[LICENSE.md](LICENSE.md)）。SDK と同じ文面です。

- 本ソフトウェアをそのまま自分のアプリ・サイト・サービス・作品に組み込んで使えます（商用・非商用を問わず）。改変はできません（ソースコード・モデルの重み・アバター素材を含む。自分のアプリのビルドで依存として取り込み、バンドル・圧縮することは改変にあたりません）。
- **条件**：それで作った映像を使うアプリ・サイト・作品では、利用者が見つけられる場所に、次のクレジットを表示してください。URL はリンクにします（リンクを埋め込めない媒体では URL を文字で書けば足ります）。
  - クレジット：「リップシンク：ZEN-LipSync（https://zenryokukikai.com）」
- **再配布はできません。** 本ソフトウェア、アバター素材、モデルの重みは、第三者への再配布・再許諾・販売・譲渡・貸与ができません（自分のアプリ・サービスの中で使うことはできます）。
- **機械学習への利用はできません。** 本ソフトウェア、アバター素材、モデルの重み、およびそれらで作った映像を、他のモデルの学習・蒸留・評価に使うことはできません。
- **アバター「全力 マリン」「全力 ハシロウ」「全力 キッカ」の素材は、LICENSE.md の 4 章の範囲で使えます。**
  - 使えること：リップシンクさせたアバターとして、アプリ・サイト・作品の中で使うこと（商用を含む）。そのとき、AI による映像のアバターであることが分かるようにしてください。
  - 禁止：なりすまし、実在の人が話していると思わせる使い方、アダルト・暴力的な内容、中傷・差別、政治広告・選挙運動・宗教の勧誘、詐欺、法令違反、顔や映像を取り出してほかの映像の作成やほかのモデルの学習に使うこと、公式だと誤解させる使い方。
- 第三者の部分は [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) を見てください。
