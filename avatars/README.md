# アバター

- `marine/`：アバター「全力 マリン（ぜんりょく まりん）」。`avatar.json` から読み込みます（SDK の `create({ avatar: "avatars/marine/avatar.json" })`）。
  - `normal/`、`angry/`：待機映像ごとのアバターパック（形式は [SDK の docs/AVATAR-PACK.md](https://github.com/zenryokukikai/zen-lipsync/blob/main/docs/AVATAR-PACK.md)）
  - `models/`：2 つの待機映像で共通のモデル（`frame.i8.wgw`、`frame.lip8`、`sentence.wgw`）
  - `idle-switch.json`：待機映像を切り替えるときの、似たフレームの対応表
- `hashiro/`：アバター「全力 ハシロウ（ぜんりょく はしろう）」。読み込みは `create({ avatar: "avatars/hashiro/avatar.json" })`。
  - 中身の並びはマリンと同じです（`normal/`、`angry/`、`models/`、`idle-switch.json`）。
- `kikka/`：アバター「全力 キッカ（ぜんりょく きっか）」。読み込みは `create({ avatar: "avatars/kikka/avatar.json" })`。
  - 待機映像は 1 種類です（`normal/`）。中身の並びはマリンと同じで、`models/` はこのアバター専用です。

使い方の決まりは [LICENSE.md](../LICENSE.md) の 4 章です。新しいアバター（ご自身の顔・映像）のモデル作成は、全力機械にご依頼ください（https://zenryokukikai.com ）。
