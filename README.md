# お絵描きマルチプレイ広場

## 概要
7ゲームを固定卓のロビーから遊ぶWebアプリです。公開URL: https://eshiritori.hansamubanana.workers.dev
バニラJavaScript・フロントエンドのビルドなし。画面はWorkers Assets、同期はTypeScriptのWorkerとSQLite版Durable ObjectsのWebSocketで提供します。

## 主な機能
- ゲームごとに6卓、合計42卓。ゲームタブの選択を端末に保存し、席・人数・待機中／満席／対戦中を表示します。
- 名前は初回に入力。着席した全員の準備完了で開始し、対戦中は観戦できます。上部の「ロビーへ」で退席します。
- ワードウルフは3〜6人、それ以外は2〜4人。定員・最低人数は `catalog.js` で定義します。
- ロビーチャット、卓チャット、フレンドコードの完全一致照会による相互フレンド追加。「この卓に来て」の招待は席を予約せず、通常の着席判定を通します。
- 切断後も同じ端末で卓を開けば復帰できます。待機中は10分、対戦中は60秒の復帰猶予。対戦中の席が失効・退席すると、その卓を待機状態に戻して全員の準備を解除します。
- iPad横・縦・スマホに対応。PWAの画面キャッシュ、favicon、192/512pxアイコン、Apple用アイコン、1200×630pxのOGP画像を用意しています。対戦には通信が必要です。
- ページのズーム・選択・長押しメニューを抑止し、入力欄では編集できます。

## 使用技術
HTML / CSS / ES modules、Cloudflare Workers / Durable Objects（SQLite・Hibernation WebSocket API・alarm）、TypeScript、Wrangler、Node.js 22以降。
検証はPlaywright・ws・Miniflare、画像生成はSharp。既存のGoogle Fonts（Kosugi Maru / Outfit）を使用します。

## 起動方法
```sh
npm ci
npx wrangler dev
```
http://localhost:8787 を開きます。ローカル状態は `.wrangler/` に保存します。
初回接続でサーバーがUIDと256bitの秘密トークンを発行し、`localStorage` の `eshiritori.identity` に保存します。サイトデータを消すと、そのプロフィールには戻れません。

Workerを起動したまま、別ターミナルで検証します。
```sh
npx playwright install chromium
npm run typecheck
npm test
npm run test:lifecycle
npm run test:review
npm run test:tables
npm run test:ui
```
- `npm test`: 本番と同じ入口を通るアカウント・パス・認証・Origin・サイズ・頻度の拒否テスト、および全7ゲームのロビー→着席→準備→開始→1手→相手への反映。観戦、二重着席拒否、3ゲームの得点改ざん拒否、通常応答・差分内の秘密情報、フレンド卓招待も確認します。
- `test:lifecycle` / `test:review`: 隔離したMiniflareで従来の互換エンジンとアカウントの回帰テスト。認証前のDO到達拒否、チケット偽造・再利用・期限、接続枠、30日削除、購読重複、送信量、チャット偽装を検証します。旧ルームプロトコルを使う入口はテスト専用で、公開Workerにはありません。
- `test:tables`: 本番Workerのルーティングを使った隔離テスト。同時着席の競合、休止・切断復帰、期限切れ許可の再利用拒否、3ゲームの終了までの進行と時限処理・得点・手番・24時間の未使用状態削除を確認します。
- `test:ui`: 実ブラウザの全7ゲームの着席・準備・操作・同期・観戦、招待の受信と参加、再接続、PWAキャッシュを確認します。1180×820・820×1180・390×844でロビー・待機・対戦・観戦の横はみ出しとコンソールエラーを検査します。

画面画像・結果JSON・再利用するテスト端末の秘密トークンは、Gitと公開アセットから除外した `.wrangler/test-results/` に保存します。テスト端末を毎回作り直さず、実際のIP別アカウント上限を守って再実行できます。短時間に何度も実行すると、通常のIP頻度制限が適用されます。

公開環境の検証（PowerShell）:
```powershell
$env:BASE_URL = 'https://eshiritori.hansamubanana.workers.dev'
npm test
npm run test:ui
Remove-Item Env:BASE_URL
```
ログイン済みCloudflareへの公開:
```sh
npm run typecheck
npx wrangler deploy
```
公開先を変える場合は `wrangler.jsonc` の `vars.PUBLIC_ORIGIN` とHTMLのOGP URLを更新します。

## 状態と権限
- **Accounts DO**: トークンのハッシュ、プロフィール、フレンド、招待、IP制限、一度限りの接続チケット。Workerは接続チケットを検証してからLobby/Table DOへ進みます。外から内部RPCには到達できません。
- **Lobby DO**: 固定42卓の公開要約、ロビーチャット、在室、UIDごとの期限付き着席許可。許可は卓IDと世代を識別するnonceに紐づき、別卓への同時着席と古い卓からの更新・解除を拒否します。
- **Table DO**: 固定卓ごとに1つ。席、準備、観戦、復帰猶予、対戦回ID、操作ID、チャット、ゲーム状態を所有し、着席許可を更新します。DOが止まって更新できなくても許可は失効し、古い卓は操作を再開できません。
- ワードウルフ・クイズバトル・神経衰弱は専用コマンドだけを受理。現在の対戦回IDと操作IDで再送を重複処理せず、違う内容での操作ID再利用や古い対戦の操作を拒否します。正解判定・得点・進行・時間切れはサーバーで処理します。
- 上記3ゲームは受信者ごとに公開可能な状態を作ってから差分を計算します。役職・お題は本人だけ、未公開の正解・今後の問題・伏せ札の絵柄は送信しません。終了時の役職・お題、解答公開後の正解、めくられた札はゲームの進行に合わせて公開します。汎用 `get/subscribe/set/update/remove` によるゲーム状態操作は拒否します。
- 残る4ゲームは着席・準備・開始・観戦・復帰をTable DOで管理し、ゲーム本体は `sync.js` の既存APIと許可リスト付き互換エンジンを使います。汎用書き込みは着席中・対戦中に限定します。ゲームの秘密情報・判定・得点の完全なサーバー化はBで行います。
- フルDB・全ユーザー・ゲーム状態付きの部屋一覧を読むAPIはありません。ロビーが配信するのは固定卓の要約だけです。`users/<自分>` の変更は本人のみ。他人のプロフィールはフレンド向けの公開要約に限ります。
- チャットのUID・名前・時刻は認証情報とサーバーのプロフィールから設定し、クライアントはsystem投稿を作れません。

## 制限と保存期限
- 受信768KiB/メッセージ、状態8MiB/卓（互換状態7MiB＋席・操作履歴等1MiB）、画像512KiB。名前40文字、回答100文字、チャット1,000文字、チャット履歴200件。型・パス・文字長・HTML文字と制御文字を検査します。
- 接続ごと80メッセージ/秒（バースト160）、4MiB/秒、処理待ち64件。30ms間隔の描画送信に対応します。
- 同一パスの購読を接続ごとに1つにまとめ、差分を配信します。送信は接続ごと2MiB/秒（バースト10MiB）、DO全体16MiB/秒（バースト32MiB）。休止後もDOの送信予算を保持します。
- 卓32接続、同一UIDは卓ごと8接続。ロビー256接続・IPごと16。アカウント256接続・IPごと16・同一UID8接続。接続試行IPごと120回/分、卓接続試行IPごと90回/分。接続チケットはUID・IP・卓に紐づき30秒有効、一度だけ使用できます。
- アカウント10,000件・登録元IPごと32件、新規登録IPごと60回/時。30日未使用でプロフィール・フレンドコード・チケット・相互フレンド参照を削除します。
- 無操作15分、接続24時間で切断します。自動pingや在室通知では延長しません。利用者の操作で再接続できます。席なし・最終操作から24時間の卓はゲーム・チャット・操作履歴を消去し、固定卓として再利用します。
- Originは設定した公開ドメイン、ローカル実行時のlocalhost/ループバックのみ。Workerの設定・ソース・テスト・Git情報は静的公開から除外します。
- 旧 `Room` DOのバインディングは移行済みデータとの互換のために保持しますが、公開入口からは到達できず、任意のルームコードのDOは作成しません。

## ディレクトリ構成
```text
index.html / portal.js / lobby.css   ロビー、プロフィール、フレンド
catalog.js                          7ゲーム・固定42卓の定義
sync.js / table-client.js / table.css 接続、共通の席・準備・卓チャット
secure-game-client.js                サーバー判定3ゲームの描画とコマンド送信
eshiritori/ drawing-quiz/ drawing-telephone/ word-wolf/
typing-race/ quiz-battle/ memory-cards/  各ゲームの既存画面
src/worker/index.ts                  認証済み接続の振り分け
src/worker/accounts.ts               アカウント・招待・接続制限
src/worker/lobby.ts / table.ts       ロビー、着席許可、卓
src/worker/games.ts / game-data.ts   サーバー判定と非公開の問題・お題
src/worker/room.ts / schema.ts       4ゲームの互換エンジンと許可リスト
src/worker/wire.ts / patch.ts        制限、WebSocket、差分
scripts/                            自動テスト・画像生成
assets/ favicon.svg manifest.webmanifest sw.js pwa.*  PWA・画像
wrangler.jsonc                      Assets + Worker + SQLite DOの設定
```

## 今後の改善案
- **B**: 絵しりとり・お絵描きクイズ・伝言ゲーム・タイピングレースの判定・得点・状態遷移を専用コマンドへ移し、残る汎用書き込みを廃止。お絵描きクイズの正解を受信者別に配り分けます。
- 実機iPad Safari/PWAでの長時間接続・バックグラウンド復帰・描画の追加検証。
- 利用増加時の負荷測定、運用監視、アカウントDOの分割、アカウント引き継ぎ、フレンド解除・ブロック。
