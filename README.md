# お絵描きマルチプレイ広場

## 概要

ルームコードで集まって遊ぶ、バニラJavaScript・フロントエンドビルド不要のWebアプリです。
公開URL: https://eshiritori.hansamubanana.workers.dev
静的画面はWorkers Assets、同期はWorker（TypeScript）とSQLite版Durable ObjectsのWebSocketで提供します。旧データの取り込みはありません。

## 主な機能

- 絵しりとり、お絵描きクイズ、お絵描き伝言、ワードウルフ、タイピングレース、クイズバトル、神経衰弱の7ゲーム。
- 同じルームコードで作成・参加。ワードウルフは3人以上、それ以外は2人以上。既存ルール・レイアウト・配色を維持。
- プロフィール、コード完全一致による相互フレンド追加、オンライン状況、招待。
- スマホ・タブレット・PC対応、ホーム画面への追加、画面ファイルのキャッシュ。オフラインでの対戦はできません。
- favicon、192/512pxのPWAアイコン、Apple用アイコン、1200×630pxのOGP画像。
- ズーム・文字選択・長押しメニューの抑止と、入力欄の編集許可。ブラウザやOSが強制する設定は優先される場合があります。

## 使用技術

- HTML / CSS / ES modules（フレームワークなし）
- Cloudflare Workers / Durable Objects（SQLite・Hibernation WebSocket API・alarm）
- TypeScript / Wrangler、Node.js 22以降
- Playwright / ws（検証）、sharp（アイコン・OGP生成）
- 既存デザインのGoogle Fonts（Kosugi Maru / Outfit）

## 起動方法

```sh
npm ci
npx wrangler dev
```

http://localhost:8787 を開きます。ローカルデータは `.wrangler/` に保存されます。
初回接続でサーバーがIDと256bitの秘密トークンを発行し、`localStorage` の `eshiritori.identity` に保存します。サイトデータを削除するとそのプロフィールには戻れません。別端末・別ブラウザプロファイルは別ユーザーです。

Workerを起動したまま検証します。

```sh
npm run typecheck
npx playwright install chromium
npm test
npm run test:lifecycle
npm run test:review
npm run test:ui
```

`npm test` はWebSocketの認証・権限・同期・招待・拒否テスト、`npm run test:lifecycle` は隔離したMiniflare環境でDO休止・復帰、時刻を進めた実際のalarm処理、削除後の再作成、容量・接続上限を検証します。テスト専用入口は本番に含まれません。
`npm run test:ui` は実ブラウザで全7ゲームの作成→参加→操作→相手への反映、招待承諾、コンソールエラー、375/768/1280pxの画面と操作制限を検証します。ワードウルフだけ3クライアントを使います。画像と結果JSONは `test-results/` に出力します。
`npm run test:review` は隔離したMiniflareでレビュー5項目を検証します。部屋DO呼び出し回数の計測、チケットの偽造・再利用・期限・IP・部屋不一致、部屋総数、IP同時接続数、無操作切断、アカウント上限・30日削除、購読重複・差分サイズ・送信量制限、チャット送信者偽装・system投稿拒否を含みます。上限到達や時刻変更のfixtureは本番に公開しません。

PowerShellで公開環境を検証する場合:

```powershell
$env:BASE_URL = 'https://eshiritori.hansamubanana.workers.dev'
npm test
npm run test:ui
Remove-Item Env:BASE_URL
```

Cloudflareにログインした状態で公開します。

```sh
npm run typecheck
npx wrangler deploy
```

公開先を変える場合は `wrangler.jsonc` の `vars.PUBLIC_ORIGIN` とHTMLのOGP URLを更新します。指定公開Originと、ローカル実行時のlocalhost/ループバックのみ許可し、プレビューURLは自動許可しません。

## サーバーの制限とデータ管理

- `sync.js` は使用箇所に合わせた `ref/get/set/update/push/remove/onValue/onDisconnect` の薄い互換層です。ブラウザに直接データストアを操作させません。
- 部屋は `<ゲーム種別>/<完全なコード>` ごとに1つのDO。コードは英数字・`_`・`-`、1〜64文字。コードを知る人にその部屋の読み取りを許可するため、推測されにくいコードを共有してください。
- 部屋DOの呼び出し前に、認証済みアカウント接続で発行した30秒・一回限りのチケットを共通DOで検証します。チケットはUID・IP・ゲーム・部屋に紐づけ、秘密トークンはURLに載せません。同じチケットの同時使用も片方だけを許可します。
- 有効部屋・予約の合計は512。新規予約は2分、書き込み後は24時間で期限切れになります。存在しない部屋への招待でも部屋DOを起動しません。
- 全体・部屋一覧・ユーザー一覧の取得は拒否。ルートの `update` は同一の完全指定部屋への原子的更新だけを許可します。
- ゲームごとのパス、フィールド、型、配列数を検証。参加者・ホスト・手番のキャンバス・本人の回答等を制限し、検証後にSQLiteへ保存して配信します。
- `users/<自分>` の変更は本人のトークンが必要。他人のプロフィールはフレンドに限り名前・状態・最終接続の要約だけを返します。トークンはハッシュで保存し、読み取りAPIには出しません。
- 相互フレンド追加・招待は専用サーバー操作。他人の `users` をブラウザから書くことはできません。招待先はフレンド、招待元は参加中の部屋に限定し、表示時の有効期間は1分です。
- テキストの長さ・制御文字・HTMLタグ文字を検証。名前40文字、回答200文字、チャット1,000文字。画像はPNG/JPEGのbase64データURL、最大512KiB。
- 受信1メッセージ768KiB、1部屋8MiB。接続ごと80メッセージ/秒、バースト160、4MiB/秒。DOの処理待ちは最大64件。30ms間隔のお絵描き送信に対応します。
- 同一パスの購読は接続ごとに1つ。クライアントの複数リスナーは1購読へまとめます。初回以外は変更パスだけを配信し、親子の購読も1フレームにまとめます。送信上限は接続ごと2MiB/秒・初期バースト10MiB、部屋全体16MiB/秒・バースト32MiB。初期取得・get・再購読も含めて計上し、超過時は切断します。部屋の送信予算はDO休止後も保持します。
- 1部屋32接続・16参加者、アカウントDO全体256接続、同一ユーザーは各DOで8接続、1接続24購読。フレンド100人、保留招待20件、チャット履歴200件。
- アカウント接続はIPごと同時16、接続試行120回/分。部屋への接続試行はIPごと90回/分、チケット発行120回/分、新規部屋はIPごと60回/時。部屋DOに到達する前に拒否します。
- アカウントは合計10,000、登録元IPごと32。新規登録はIPごと60回/時、部屋作成はユーザーごと30回/時、コード照会60回/時、招待30回/分。既存アカウントの登録元IPが未記録の場合は次回認証時に割り当てます。
- アカウント接続は15分の無操作、または24時間の接続で切断します。自動ping・在席通知では延長せず、実際のゲーム書き込みは操作として扱います。無操作切断後はユーザーのクリック・キー入力で再接続し、自動在席通知だけで再接続しません。
- アカウントはサーバーが記録した最終利用から30日で認証不能になり、alarmで削除します。フレンドコード・未使用チケットと相互フレンド参照も削除します。接続がなくても掃除alarmは継続します。
- 期限切れの認証情報で再訪したブラウザには新しいIDを発行し、プロフィール登録からやり直します。削除済みのプロフィールやフレンドを復元する処理はありません。
- チャットは本文のみを受け付け、UID・最新のプロフィール名・投稿時刻・種別をサーバーで設定します。送信者やsystem/correct等の種別を含む投稿は拒否します。system投稿はゲーム状態の遷移からサーバーだけが生成します。
- 部屋は最終書き込みから24時間後にalarmで削除し、接続も終了。読み取り・pingでは期限を延長しません。未認証ソケットは約30秒で終了します。
- WebSocket再接続時に認証・購読を復元。確定前に切れた書き込みは自動再送せず失敗を返します。ホスト離脱時の自動引き継ぎはありません。
- Service Workerは画面ファイルのみキャッシュし、`/ws` 通信は素通しです。Workerソース・設定・依存ライブラリ・テスト・Git情報は `.assetsignore` で配信から除外します。

## ディレクトリ構成

```text
index.html / portal.js / style.css   ポータル・プロフィール・フレンド
sync.js                             WebSocket互換クライアント
eshiritori/                         絵しりとり
drawing-quiz/                       お絵描きクイズ
drawing-telephone/                  お絵描き伝言
word-wolf/                         ワードウルフ
typing-race/                       タイピングレース
quiz-battle/                       クイズバトル
memory-cards/                      神経衰弱
src/worker/index.ts                 /wsルーティング・Origin検証
src/worker/room.ts                  部屋DO・保存・配信・期限
src/worker/accounts.ts              ID・認証・フレンド・招待
src/worker/schema.ts / wire.ts      パス・型・容量・頻度等の検証
scripts/                           自動テスト・画像生成
assets/ / favicon.svg              アイコン・OGP
manifest.webmanifest / sw.js        PWA・画面キャッシュ
pwa.js / pwa.css                    操作制御・入力欄の例外
wrangler.jsonc / .assetsignore      デプロイ・静的配信範囲
```

## 今後の改善案

- テーブル制ロビー（今回の対象外）。
- 得点計算・問題選択・すべての進行判定をサーバーコマンドに移し、不正なゲーム操作への耐性をさらに高める。
- ホスト切断時の引き継ぎ、退室、観戦、期限終了時の画面案内。
- 端末変更時のアカウント引き継ぎ、フレンド解除・ブロック。
- 実機Safariでのホーム画面・ジェスチャー、大人数・長時間接続の追加検証。
- 利用増加時のアカウントDO分割、負荷測定と運用監視。

構成の詳細は [静的アセットの公式資料](https://developers.cloudflare.com/workers/static-assets/binding/) と [WebSocket Hibernation API](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) を参照してください。
