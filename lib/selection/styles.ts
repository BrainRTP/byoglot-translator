export const HOST_STYLE = [
  "all: initial",
  "position: fixed",
  "top: 0",
  "left: 0",
  "width: 0",
  "height: 0",
  "display: block",
  "z-index: 2147483647",
]
  .map((d) => `${d} !important`)
  .join("; ");

export const LIGHT =
  "--bg:#FFFFFF;--sf:#F5F6F7;--bd:#D9DCE0;--bd2:#8A929C;--tx:#14171A;--mu:#566070;--ac:#1D5BD1;--er:#B3261E;--wn:#8A5300;--sh:0 6px 20px rgba(20,23,26,.16)";
export const DARK =
  "--bg:#16181B;--sf:#1D2024;--bd:#33373D;--bd2:#6C737D;--tx:#ECEEF0;--mu:#A3AAB4;--ac:#7AA7FF;--er:#FF8F86;--wn:#F0B84A;--sh:0 6px 20px rgba(0,0,0,.55)";

export const STYLES = `
.root{${LIGHT};color-scheme:light dark;font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;font-size:13px;line-height:1.45;color:var(--tx)}
.root[data-theme="dark"]{${DARK};color-scheme:dark}
.root[data-theme="light"]{color-scheme:light}
@media (prefers-color-scheme: dark){.root:not([data-theme="light"]){${DARK}}}
*,*::before,*::after{box-sizing:border-box}
.btn{font:inherit;height:36px;padding:0 14px;border-radius:6px;border:1px solid var(--bd2);background:var(--bg);color:var(--tx);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:8px;text-align:center}
.btn.sm{min-height:28px;height:auto;padding:3px 10px;font-size:12px;line-height:1.3}
.btn.ico{width:28px;height:28px;padding:0;flex:none}
.btn.ico.flat{border-color:transparent;background:none;color:var(--mu)}
.btn:focus-visible,.tsel:focus-visible,.scroll:focus-visible{outline:2px solid var(--ac);outline-offset:2px}
.icon{position:fixed;width:24px;height:24px;padding:0;border-radius:6px;border:1px solid var(--bd2);background:var(--bg);color:var(--tx);box-shadow:var(--sh);display:flex;align-items:center;justify-content:center;cursor:pointer;opacity:.85}
.icon:hover,.icon:focus-visible{opacity:1}
.icon:focus-visible{outline:2px solid var(--ac);outline-offset:2px}
.revert{position:absolute;left:4px;top:0;width:24px;height:24px;padding:0;border-radius:6px;border:1px solid var(--bd2);background:var(--bg);color:var(--tx);box-shadow:var(--sh);display:flex;align-items:center;justify-content:center;cursor:pointer;opacity:.35}
.revert:hover,.revert:focus-visible{opacity:1}
.revert:focus-visible{outline:2px solid var(--ac);outline-offset:2px}
.revert .spin{width:12px;height:12px}
.card{position:fixed;max-width:calc(100vw - 16px);background:var(--bg);color:var(--tx);border:1px solid var(--bd);border-radius:8px;box-shadow:var(--sh);padding:10px 12px 12px;display:flex;flex-direction:column;gap:10px}
.head{display:flex;align-items:center;gap:8px;cursor:move;user-select:none;touch-action:none}
.grip{position:absolute;right:0;bottom:0;width:14px;height:14px;cursor:nwse-resize;user-select:none;touch-action:none;background:linear-gradient(135deg,transparent 0 52%,var(--bd2) 52% 62%,transparent 62% 74%,var(--bd2) 74% 84%,transparent 84%)}
.feed{flex:1 1 auto;min-height:0;overflow-y:auto;scrollbar-width:thin;margin:-3px;padding:3px}
.pin[aria-pressed="true"]{color:var(--ac)}
.src{color:var(--mu);font-size:12px;line-height:18px;margin-bottom:6px;overflow-wrap:anywhere;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-clamp:2;overflow:hidden}
.pinned .entry{padding:10px 0;border-bottom:1px solid var(--bd)}
.pinned .entry:first-child{padding-top:0}
.pinned .entry:last-child{border-bottom:0;padding-bottom:0}
.pinned .scroll{border:0;padding:6px 0}
.pinned .entry>.lang{display:block;margin-bottom:2px}
.lang{color:var(--mu);font-size:12px;flex:1 1 auto;min-width:0}
.muted{color:var(--mu)}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;overflow-wrap:anywhere}
.loading{display:flex;align-items:center;gap:10px;color:var(--mu);min-height:56px}
.spin{width:14px;height:14px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:sp .8s linear infinite}
@keyframes sp{to{transform:rotate(360deg)}}
.err{display:flex;flex-direction:column;gap:8px}
.et{font-weight:600}.et.er{color:var(--er)}.et.wn{color:var(--wn)}
.cmd{background:var(--sf);border:1px solid var(--bd);border-radius:4px;padding:6px 10px}
.foot{display:flex;flex-direction:column;gap:8px}
.bar{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
.btns{display:flex;gap:8px;flex-wrap:wrap}
kbd{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;border:1px solid var(--bd2);border-radius:4px;padding:1px 5px;color:var(--mu)}
.tsel{font:inherit;font-size:12px;height:28px;min-width:0;flex:0 1 190px;border:1px solid var(--bd2);border-radius:6px;background:var(--bg);color:var(--tx);padding:0 6px;text-overflow:ellipsis}
.scroll{max-height:min(236px,50vh);overflow-y:auto;scrollbar-width:thin;border-top:1px solid var(--bd);border-bottom:1px solid var(--bd);padding:12px 12px 12px 0}
.free .scroll{max-height:none}
.md{font-size:14px;line-height:22px;overflow-wrap:anywhere}
.md p{margin:0 0 10px}
.md ul,.md ol{margin:0 0 10px;padding-left:22px}
.md li{margin:0 0 6px}
.md li::marker{color:var(--mu)}
.md strong{font-weight:600}
.md em{font-style:italic}
.md code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.9em;background:var(--sf);border-radius:3px;padding:0 3px}
.md .h{margin:14px 0 6px;font-weight:600;color:var(--mu);font-size:12px;line-height:18px}
.md > :first-child{margin-top:0}
.md > :last-child{margin-bottom:0}
`;
