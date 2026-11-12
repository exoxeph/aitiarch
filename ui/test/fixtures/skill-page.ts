// A full page of the kind a diagram skill produces: a style block with CSS custom properties on :root, page rules, svg rules, an @font-face,
// a dark-mode @media block, and the drawing itself. All synthetic.
export const PAGE=`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Release flow</title>
<style>
:root{--paper:#f4efe6;--ink:#1c1b19;--accent:#c4552d;--rule:rgba(28,27,25,.25);--font:'Segoe UI',system-ui,sans-serif}
html,body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--font)}
.wrap{max-width:900px;margin:auto;padding:24px}
svg{width:100%;height:auto}
.box{fill:var(--paper);stroke:var(--ink);stroke-width:1.5}
.box.hot{stroke:var(--accent)}
.label{font-size:14px;font-weight:600;fill:var(--ink)}
.arrow{stroke:var(--rule);fill:none;marker-end:url(#head)}
@media (prefers-color-scheme:dark){:root{--paper:#111}}
@font-face{font-family:Evil;src:url(https://evil.test/f.woff)}
</style></head>
<body><div class="wrap"><h1>Release flow</h1>
<svg viewBox="0 0 400 200" role="img" aria-label="Release flow"><title>Release flow</title>
<defs><marker id="head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10z" fill="var(--ink)"/></marker></defs>
<rect class="box" x="20" y="60" width="120" height="60" rx="6"/>
<text class="label" x="80" y="95" text-anchor="middle">Build</text>
<rect class="box hot" x="260" y="60" width="120" height="60" rx="6" style="stroke:var(--accent);--local:red"/>
<text class="label" x="320" y="95" text-anchor="middle">Release</text>
<path class="arrow" d="M140 90H260"/>
</svg><p>Footnote text outside the drawing.</p></div></body></html>`;
export const BARE='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20" width="40" height="20"><rect x="1" y="1" width="38" height="18" fill="#eee" stroke="#333"/><text x="6" y="14" font-size="10">Plan é</text></svg>';
