const editable = target => target instanceof Element && !!target.closest('input, textarea, [contenteditable="true"]');
document.addEventListener('contextmenu', event => { if (!editable(event.target)) event.preventDefault(); });
document.addEventListener('selectstart', event => { if (!editable(event.target)) event.preventDefault(); });
document.addEventListener('dragstart', event => { if (!editable(event.target)) event.preventDefault(); });
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(type, event => event.preventDefault(), { passive: false });
document.addEventListener('touchmove', event => { if (event.touches.length > 1) event.preventDefault(); }, { passive: false });
let lastTap = 0;
document.addEventListener('touchend', event => {
    const now = Date.now();
    if (!editable(event.target) && now - lastTap < 300) event.preventDefault();
    lastTap = now;
}, { passive: false });
document.addEventListener('dblclick', event => { if (!editable(event.target)) event.preventDefault(); }, { passive: false });
document.addEventListener('wheel', event => { if (event.ctrlKey) event.preventDefault(); }, { passive: false });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
