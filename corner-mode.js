(function() {
    // 1. スタイルの定義と注入
    function injectStyles() {
        const styleId = 'corner-mode-injected-styles';
        if (document.getElementById(styleId)) return;
        
        const styleEl = document.createElement('style');
        styleEl.id = styleId;
        styleEl.innerHTML = `
            /* 画面切替フローティングボタン */
            .corner-mode-toggle-btn {
                position: fixed !important;
                top: 15px !important;
                right: 15px !important;
                z-index: 100000 !important;
                background-color: #34495e !important;
                color: #ffffff !important;
                border: 2px solid #2c3e50 !important;
                border-bottom: 4px solid #202d3b !important;
                border-radius: 30px !important;
                padding: 10px 18px !important;
                font-size: 14px !important;
                font-family: inherit !important;
                cursor: pointer !important;
                box-shadow: 0 4px 15px rgba(0,0,0,0.3) !important;
                transition: all 0.1s ease !important;
                font-weight: bold !important;
            }
            .corner-mode-toggle-btn:hover {
                background-color: #2c3e50 !important;
                transform: translateY(-2px) !important;
            }
            .corner-mode-toggle-btn:active {
                transform: translateY(1px) !important;
                border-bottom-width: 1px !important;
            }

            /* 右下手元モードがアクティブのとき */
            body.corner-mode-active {
                background-color: #000000 !important;
                background-image: none !important;
                overflow: hidden !important;
                width: 100vw !important;
                height: 100vh !important;
                margin: 0 !important;
                padding: 0 !important;
            }

            /* コンテナを縮小して画面右下に固定 */
            body.corner-mode-active .portal-container,
            body.corner-mode-active .container {
                position: fixed !important;
                bottom: 15px !important;
                right: 15px !important;
                top: auto !important;
                left: auto !important;
                width: 380px !important;
                height: 580px !important;
                max-width: 95vw !important;
                max-height: 85vh !important;
                padding: 15px !important;
                margin: 0 !important;
                border: 4px solid #6d5843 !important;
                border-radius: 16px !important;
                background-color: #fffdf9 !important;
                box-shadow: 0 10px 35px rgba(255,255,255,0.15) !important;
                overflow-y: auto !important;
                overflow-x: hidden !important;
                display: flex !important;
                flex-direction: column !important;
                z-index: 99999 !important;
                box-sizing: border-box !important;
                transform: none !important;
                animation: fadeInCorner 0.3s ease !important;
            }

            @keyframes fadeInCorner {
                from { opacity: 0; transform: scale(0.95) translate(10px, 10px); }
                to { opacity: 1; transform: scale(1) translate(0, 0); }
            }

            /* 不要なヘッダーや装飾を非表示 */
            body.corner-mode-active header,
            body.corner-mode-active .portal-container::before,
            body.corner-mode-active .container::before {
                display: none !important;
            }

            /* 遊び方説明、フッターなどを非表示 */
            body.corner-mode-active footer,
            body.corner-mode-active .instructions-card,
            body.corner-mode-active #screen-setup p,
            body.corner-mode-active #global-roadmap-box p {
                display: none !important;
            }

            /* ポータルの2カラムレイアウトを解除 */
            body.corner-mode-active .portal-main-layout {
                grid-template-columns: 1fr !important;
                gap: 15px !important;
            }

            /* ゲームカードのサイズを小さく */
            body.corner-mode-active .game-card {
                padding: 12px !important;
                border-width: 2px !important;
            }
            body.corner-mode-active .game-card-content {
                margin-bottom: 8px !important;
            }
            body.corner-mode-active .game-icon {
                font-size: 24px !important;
                margin-bottom: 4px !important;
            }
            body.corner-mode-active .game-title {
                font-size: 15px !important;
            }
            body.corner-mode-active .game-desc {
                font-size: 11px !important;
                line-height: 1.3 !important;
            }
            body.corner-mode-active .play-btn {
                font-size: 12px !important;
                padding: 6px 12px !important;
                border-bottom-width: 2px !important;
            }
            body.corner-mode-active .badge {
                display: none !important;
            }

            /* キャンバスとゲーム画面のレイアウト調整 */
            body.corner-mode-active #canvas,
            body.corner-mode-active .live-canvas-display {
                width: 100% !important;
                max-width: 280px !important;
                height: auto !important;
            }
            body.corner-mode-active .game-main-layout,
            body.corner-mode-active .quiz-main-layout,
            body.corner-mode-active .game-layout {
                display: flex !important;
                flex-direction: column !important;
                align-items: center !important;
                justify-content: flex-start !important;
                gap: 10px !important;
            }
            body.corner-mode-active .palette-container {
                padding: 4px !important;
                gap: 4px !important;
                max-width: 280px !important;
            }
            body.corner-mode-active .color-dot {
                width: 20px !important;
                height: 20px !important;
            }
            body.corner-mode-active .eraser-btn {
                font-size: 10px !important;
                padding: 2px 6px !important;
            }
            body.corner-mode-active .tool-select {
                font-size: 11px !important;
                padding: 2px 4px !important;
            }

            /* 文字サイズやボタンサイズ調整 */
            body.corner-mode-active h1 {
                font-size: 18px !important;
                margin-top: 5px !important;
                margin-bottom: 10px !important;
                text-align: center !important;
            }
            body.corner-mode-active h2 {
                font-size: 16px !important;
                margin: 5px 0 !important;
                text-align: center !important;
            }
            body.corner-mode-active h3 {
                font-size: 14px !important;
                margin: 5px 0 !important;
                text-align: center !important;
            }
            body.corner-mode-active p {
                font-size: 12px !important;
                margin: 5px 0 !important;
                text-align: center !important;
            }
            body.corner-mode-active input[type="text"] {
                width: 80% !important;
                padding: 6px !important;
                font-size: 14px !important;
                box-sizing: border-box !important;
            }
            body.corner-mode-active button {
                padding: 6px 14px !important;
                font-size: 13px !important;
            }
            body.corner-mode-active .lobby-list {
                padding: 10px !important;
                margin: 10px auto !important;
                width: 100% !important;
                box-sizing: border-box !important;
            }
            body.corner-mode-active #global-roadmap-box {
                margin-bottom: 10px !important;
                width: 100% !important;
            }
            body.corner-mode-active .roadmap-outer {
                padding: 5px !important;
                margin-bottom: 10px !important;
            }
            body.corner-mode-active .roadmap-node {
                width: 60px !important;
                padding: 3px !important;
            }
            body.corner-mode-active .node-img {
                width: 45px !important;
                height: 45px !important;
            }
            body.corner-mode-active .node-pname {
                font-size: 9px !important;
            }
            body.corner-mode-active .node-chars {
                font-size: 9px !important;
            }
            body.corner-mode-active .roadmap-endpoint {
                width: 35px !important;
                height: 35px !important;
                line-height: 35px !important;
                font-size: 16px !important;
            }

            /* クイズゲーム専用の調整 */
            body.corner-mode-active .chat-container {
                width: 100% !important;
                max-width: 280px !important;
                height: 180px !important;
                order: 2 !important;
            }
            body.corner-mode-active .canvas-container {
                order: 1 !important;
            }
            body.corner-mode-active .scoreboard-container {
                width: 100% !important;
                max-width: 280px !important;
                min-height: auto !important;
                padding: 8px !important;
                order: 3 !important;
            }
            body.corner-mode-active .game-info-bar {
                width: 100% !important;
                padding: 6px 10px !important;
                margin-bottom: 8px !important;
                gap: 5px !important;
                flex-wrap: nowrap !important;
                justify-content: space-between !important;
            }
            body.corner-mode-active .timer-box {
                font-size: 13px !important;
                padding: 4px 10px !important;
            }
            body.corner-mode-active .secret-word-display {
                font-size: 13px !important;
                padding: 4px 10px !important;
            }
            body.corner-mode-active .secret-word-guesser {
                font-size: 12px !important;
                padding: 4px 10px !important;
                letter-spacing: 2px !important;
            }
            body.corner-mode-active #role-text {
                font-size: 12px !important;
            }
            body.corner-mode-active .chat-messages {
                padding: 8px !important;
                gap: 4px !important;
            }
            body.corner-mode-active .message {
                padding: 4px 8px !important;
                font-size: 12px !important;
            }

            /* 伝言ゲーム専用の調整 */
            body.corner-mode-active .reference-card {
                width: 100% !important;
                max-width: 280px !important;
                padding: 10px !important;
            }
            body.corner-mode-active .reference-image {
                max-width: 240px !important;
            }
            body.corner-mode-active .waiting-status-list {
                width: 100% !important;
                max-width: 280px !important;
                padding: 10px !important;
            }
            body.corner-mode-active .chain-item {
                width: 100% !important;
                max-width: 280px !important;
                padding: 10px !important;
            }
            body.corner-mode-active .chain-item-image {
                max-height: 180px !important;
            }
            body.corner-mode-active .showcase-container {
                max-width: 100% !important;
            }
            body.corner-mode-active .showcase-chain {
                gap: 8px !important;
            }
            body.corner-mode-active .showcase-nav {
                margin-top: 15px !important;
                gap: 8px !important;
            }
            body.corner-mode-active .showcase-info {
                font-size: 13px !important;
            }

            /* 結果発表グリッドの調整 */
            body.corner-mode-active .result-grid {
                grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)) !important;
                gap: 8px !important;
            }
            body.corner-mode-active .result-card {
                padding: 6px !important;
            }
            body.corner-mode-active .result-card div {
                font-size: 10px !important;
            }

            /* モーダル類の調整 */
            body.corner-mode-active .invite-notification-modal,
            body.corner-mode-active #lobby-invite-modal,
            body.corner-mode-active #preview-overlay {
                position: fixed !important;
                top: 0 !important;
                left: 0 !important;
                width: 100vw !important;
                height: 100vh !important;
                z-index: 100001 !important;
            }
            body.corner-mode-active .invite-modal-content,
            body.corner-mode-active #lobby-invite-modal > div,
            body.corner-mode-active #preview-box {
                max-width: 280px !important;
                padding: 15px !important;
            }
        `;
        if (document.head) {
            document.head.appendChild(styleEl);
        } else {
            document.addEventListener('DOMContentLoaded', () => {
                document.head.appendChild(styleEl);
            });
        }
    }
    injectStyles();

    // 2. ボタンの追加とイベント監視
    function initCornerMode() {
        // すでにボタンがあればスキップ
        if (document.getElementById('toggle-corner-mode-btn')) return;

        // localStorage の状態を反映
        const isCornerMode = localStorage.getItem('cornerModeActive') === 'true';
        if (isCornerMode) {
            document.body.classList.add('corner-mode-active');
        }

        // 切り替えボタン作成
        const btn = document.createElement('button');
        btn.id = 'toggle-corner-mode-btn';
        btn.className = 'corner-mode-toggle-btn';
        btn.innerHTML = isCornerMode ? '🖥️ 通常モード' : '📱 画面右下モード';
        
        btn.addEventListener('click', () => {
            const currentlyActive = document.body.classList.contains('corner-mode-active');
            if (currentlyActive) {
                document.body.classList.remove('corner-mode-active');
                localStorage.setItem('cornerModeActive', 'false');
                btn.innerHTML = '📱 画面右下モード';
            } else {
                document.body.classList.add('corner-mode-active');
                localStorage.setItem('cornerModeActive', 'true');
                btn.innerHTML = '🖥️ 通常モード';
            }
        });

        document.body.appendChild(btn);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initCornerMode);
    } else {
        initCornerMode();
    }
})();
