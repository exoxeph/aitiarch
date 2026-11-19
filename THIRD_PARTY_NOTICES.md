# Third-party notices

This inventory covers the production dependency tree in `ui/package-lock.json`. Versions and licence declarations were checked against installed package metadata. “Browser bundle” identifies packages present in the Vite entry or a lazy chunk. “Production install” covers the rest of the dependency tree available to the local app and server, including packages the browser build does not ship.

## Distribution notes

- Keep the upstream copyright and licence text for distributed MIT, ISC and BSD code. Preserve package-specific notices such as es-toolkit's NOTICE. Apache-2.0 redistribution also requires the licence and applicable upstream notices. [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0)
- elkjs declares EPL-2.0 or GPL-3.0-or-later. Its installed licence file contains EPL-2.0, which requires making the covered source available and telling recipients how to obtain it when distributing in object form. The GPL alternative carries its own copyleft obligations. [elkjs source](https://github.com/kieler/elkjs) · [EPL-2.0](https://www.eclipse.org/legal/epl-2.0/)
- DOMPurify offers MPL-2.0 or Apache-2.0. Its installed package includes the Apache-2.0 text. The MPL alternative has file-level copyleft obligations. [DOMPurify license](https://github.com/cure53/DOMPurify/blob/main/LICENSE)
- dictionary-en declares MIT AND BSD. Its bundled licence carries several upstream dictionary notices. Retain all applicable notices from the package.
- khroma leaves the licence field out of its package metadata. Its bundled licence declares MIT and credits Fabio Spampinato and Andrew Maney.
- Mermaid is MIT, copyright 2014–2022 Knut Sveidqvist. KaTeX is MIT, copyright 2013–2020 Khan Academy and other contributors. Aitiarch renders native MathML without the separately MIT-licensed KaTeX fonts or stylesheet. [KaTeX font licence](https://github.com/KaTeX/katex-fonts/blob/master/LICENSE)

## Production dependencies

| Package | Version | Licence | Scope |
| --- | --- | --- | --- |
| [@antfu/install-pkg](https://www.npmjs.com/package/@antfu/install-pkg/v/2.1.0) | 2.1.0 | MIT | Production install |
| [@braintree/sanitize-url](https://www.npmjs.com/package/@braintree/sanitize-url/v/7.1.2) | 7.1.2 | MIT | Browser bundle |
| [@chevrotain/cst-dts-gen](https://www.npmjs.com/package/@chevrotain/cst-dts-gen/v/13.2.0) | 13.2.0 | Apache-2.0 | Production install |
| [@chevrotain/gast](https://www.npmjs.com/package/@chevrotain/gast/v/13.2.0) | 13.2.0 | Apache-2.0 | Browser bundle |
| [@chevrotain/regexp-to-ast](https://www.npmjs.com/package/@chevrotain/regexp-to-ast/v/13.2.0) | 13.2.0 | Apache-2.0 | Browser bundle |
| [@chevrotain/types](https://www.npmjs.com/package/@chevrotain/types/v/13.2.0) | 13.2.0 | Apache-2.0 | Production install |
| [@chevrotain/utils](https://www.npmjs.com/package/@chevrotain/utils/v/13.2.0) | 13.2.0 | Apache-2.0 | Browser bundle |
| [@codemirror/autocomplete](https://www.npmjs.com/package/@codemirror/autocomplete/v/6.20.4) | 6.20.4 | MIT | Browser bundle |
| [@codemirror/commands](https://www.npmjs.com/package/@codemirror/commands/v/6.11.1) | 6.11.1 | MIT | Browser bundle |
| [@codemirror/lang-css](https://www.npmjs.com/package/@codemirror/lang-css/v/6.3.1) | 6.3.1 | MIT | Browser bundle |
| [@codemirror/lang-html](https://www.npmjs.com/package/@codemirror/lang-html/v/6.4.12) | 6.4.12 | MIT | Browser bundle |
| [@codemirror/lang-javascript](https://www.npmjs.com/package/@codemirror/lang-javascript/v/6.2.5) | 6.2.5 | MIT | Browser bundle |
| [@codemirror/lang-json](https://www.npmjs.com/package/@codemirror/lang-json/v/6.0.2) | 6.0.2 | MIT | Browser bundle |
| [@codemirror/lang-markdown](https://www.npmjs.com/package/@codemirror/lang-markdown/v/6.5.2) | 6.5.2 | MIT | Browser bundle |
| [@codemirror/lang-python](https://www.npmjs.com/package/@codemirror/lang-python/v/6.2.1) | 6.2.1 | MIT | Browser bundle |
| [@codemirror/lang-sql](https://www.npmjs.com/package/@codemirror/lang-sql/v/6.10.0) | 6.10.0 | MIT | Production install |
| [@codemirror/lang-yaml](https://www.npmjs.com/package/@codemirror/lang-yaml/v/6.1.3) | 6.1.3 | MIT | Production install |
| [@codemirror/language](https://www.npmjs.com/package/@codemirror/language/v/6.13.1) | 6.13.1 | MIT | Browser bundle |
| [@codemirror/legacy-modes](https://www.npmjs.com/package/@codemirror/legacy-modes/v/6.5.5) | 6.5.5 | MIT | Browser bundle |
| [@codemirror/lint](https://www.npmjs.com/package/@codemirror/lint/v/6.9.7) | 6.9.7 | MIT | Production install |
| [@codemirror/search](https://www.npmjs.com/package/@codemirror/search/v/6.7.2) | 6.7.2 | MIT | Production install |
| [@codemirror/state](https://www.npmjs.com/package/@codemirror/state/v/6.7.6) | 6.7.6 | MIT | Browser bundle |
| [@codemirror/streamparser](https://www.npmjs.com/package/@codemirror/streamparser/v/6.0.0) | 6.0.0 | MIT | Browser bundle |
| [@codemirror/view](https://www.npmjs.com/package/@codemirror/view/v/6.43.15) | 6.43.15 | MIT | Browser bundle |
| [@iconify/types](https://www.npmjs.com/package/@iconify/types/v/2.0.0) | 2.0.0 | MIT | Production install |
| [@iconify/utils](https://www.npmjs.com/package/@iconify/utils/v/3.1.7) | 3.1.7 | MIT | Browser bundle |
| [@lezer/common](https://www.npmjs.com/package/@lezer/common/v/1.5.5) | 1.5.5 | MIT | Browser bundle |
| [@lezer/css](https://www.npmjs.com/package/@lezer/css/v/1.3.9) | 1.3.9 | MIT | Browser bundle |
| [@lezer/highlight](https://www.npmjs.com/package/@lezer/highlight/v/1.2.5) | 1.2.5 | MIT | Browser bundle |
| [@lezer/html](https://www.npmjs.com/package/@lezer/html/v/1.3.13) | 1.3.13 | MIT | Browser bundle |
| [@lezer/javascript](https://www.npmjs.com/package/@lezer/javascript/v/1.5.6) | 1.5.6 | MIT | Browser bundle |
| [@lezer/json](https://www.npmjs.com/package/@lezer/json/v/1.0.3) | 1.0.3 | MIT | Browser bundle |
| [@lezer/lr](https://www.npmjs.com/package/@lezer/lr/v/1.4.12) | 1.4.12 | MIT | Browser bundle |
| [@lezer/markdown](https://www.npmjs.com/package/@lezer/markdown/v/1.8.1) | 1.8.1 | MIT | Browser bundle |
| [@lezer/python](https://www.npmjs.com/package/@lezer/python/v/1.1.19) | 1.1.19 | MIT | Browser bundle |
| [@lezer/yaml](https://www.npmjs.com/package/@lezer/yaml/v/1.0.4) | 1.0.4 | MIT | Production install |
| [@marijn/find-cluster-break](https://www.npmjs.com/package/@marijn/find-cluster-break/v/1.0.4) | 1.0.4 | MIT | Browser bundle |
| [@mermaid-js/parser](https://www.npmjs.com/package/@mermaid-js/parser/v/2.0.1) | 2.0.1 | MIT | Browser bundle |
| [@types/d3](https://www.npmjs.com/package/@types/d3/v/7.4.3) | 7.4.3 | MIT | Production install |
| [@types/d3-array](https://www.npmjs.com/package/@types/d3-array/v/3.2.2) | 3.2.2 | MIT | Production install |
| [@types/d3-axis](https://www.npmjs.com/package/@types/d3-axis/v/3.0.6) | 3.0.6 | MIT | Production install |
| [@types/d3-brush](https://www.npmjs.com/package/@types/d3-brush/v/3.0.6) | 3.0.6 | MIT | Production install |
| [@types/d3-chord](https://www.npmjs.com/package/@types/d3-chord/v/3.0.6) | 3.0.6 | MIT | Production install |
| [@types/d3-color](https://www.npmjs.com/package/@types/d3-color/v/3.1.3) | 3.1.3 | MIT | Production install |
| [@types/d3-contour](https://www.npmjs.com/package/@types/d3-contour/v/3.0.6) | 3.0.6 | MIT | Production install |
| [@types/d3-delaunay](https://www.npmjs.com/package/@types/d3-delaunay/v/6.0.4) | 6.0.4 | MIT | Production install |
| [@types/d3-dispatch](https://www.npmjs.com/package/@types/d3-dispatch/v/3.0.7) | 3.0.7 | MIT | Production install |
| [@types/d3-drag](https://www.npmjs.com/package/@types/d3-drag/v/3.0.7) | 3.0.7 | MIT | Production install |
| [@types/d3-dsv](https://www.npmjs.com/package/@types/d3-dsv/v/3.0.7) | 3.0.7 | MIT | Production install |
| [@types/d3-ease](https://www.npmjs.com/package/@types/d3-ease/v/3.0.2) | 3.0.2 | MIT | Production install |
| [@types/d3-fetch](https://www.npmjs.com/package/@types/d3-fetch/v/3.0.7) | 3.0.7 | MIT | Production install |
| [@types/d3-force](https://www.npmjs.com/package/@types/d3-force/v/3.0.10) | 3.0.10 | MIT | Production install |
| [@types/d3-format](https://www.npmjs.com/package/@types/d3-format/v/3.0.4) | 3.0.4 | MIT | Production install |
| [@types/d3-geo](https://www.npmjs.com/package/@types/d3-geo/v/3.1.1) | 3.1.1 | MIT | Production install |
| [@types/d3-hierarchy](https://www.npmjs.com/package/@types/d3-hierarchy/v/3.1.7) | 3.1.7 | MIT | Production install |
| [@types/d3-interpolate](https://www.npmjs.com/package/@types/d3-interpolate/v/3.0.4) | 3.0.4 | MIT | Production install |
| [@types/d3-path](https://www.npmjs.com/package/@types/d3-path/v/3.1.1) | 3.1.1 | MIT | Production install |
| [@types/d3-polygon](https://www.npmjs.com/package/@types/d3-polygon/v/3.0.2) | 3.0.2 | MIT | Production install |
| [@types/d3-quadtree](https://www.npmjs.com/package/@types/d3-quadtree/v/3.0.6) | 3.0.6 | MIT | Production install |
| [@types/d3-random](https://www.npmjs.com/package/@types/d3-random/v/3.0.4) | 3.0.4 | MIT | Production install |
| [@types/d3-scale](https://www.npmjs.com/package/@types/d3-scale/v/4.0.9) | 4.0.9 | MIT | Production install |
| [@types/d3-scale-chromatic](https://www.npmjs.com/package/@types/d3-scale-chromatic/v/3.1.0) | 3.1.0 | MIT | Production install |
| [@types/d3-selection](https://www.npmjs.com/package/@types/d3-selection/v/3.0.12) | 3.0.12 | MIT | Production install |
| [@types/d3-shape](https://www.npmjs.com/package/@types/d3-shape/v/3.2.0) | 3.2.0 | MIT | Production install |
| [@types/d3-time](https://www.npmjs.com/package/@types/d3-time/v/3.0.4) | 3.0.4 | MIT | Production install |
| [@types/d3-time-format](https://www.npmjs.com/package/@types/d3-time-format/v/4.0.3) | 4.0.3 | MIT | Production install |
| [@types/d3-timer](https://www.npmjs.com/package/@types/d3-timer/v/3.0.2) | 3.0.2 | MIT | Production install |
| [@types/d3-transition](https://www.npmjs.com/package/@types/d3-transition/v/3.0.9) | 3.0.9 | MIT | Production install |
| [@types/d3-zoom](https://www.npmjs.com/package/@types/d3-zoom/v/3.0.9) | 3.0.9 | MIT | Production install |
| [@types/geojson](https://www.npmjs.com/package/@types/geojson/v/7946.0.16) | 7946.0.16 | MIT | Production install |
| [@types/trusted-types](https://www.npmjs.com/package/@types/trusted-types/v/2.0.7) | 2.0.7 | MIT | Production install |
| [@upsetjs/venn.js](https://www.npmjs.com/package/@upsetjs/venn.js/v/2.0.0) | 2.0.0 | MIT | Browser bundle |
| [chevrotain](https://www.npmjs.com/package/chevrotain/v/13.2.0) | 13.2.0 | Apache-2.0 | Browser bundle |
| [codemirror](https://www.npmjs.com/package/codemirror/v/6.0.2) | 6.0.2 | MIT | Production install |
| [commander](https://www.npmjs.com/package/commander/v/15.1.0) | 15.1.0 | MIT | Production install |
| [commander](https://www.npmjs.com/package/commander/v/7.2.0) | 7.2.0 | MIT | Production install |
| [cose-base](https://www.npmjs.com/package/cose-base/v/1.0.3) | 1.0.3 | MIT | Browser bundle |
| [cose-base](https://www.npmjs.com/package/cose-base/v/2.2.0) | 2.2.0 | MIT | Browser bundle |
| [crelt](https://www.npmjs.com/package/crelt/v/1.0.7) | 1.0.7 | MIT | Production install |
| [cytoscape](https://www.npmjs.com/package/cytoscape/v/3.34.4) | 3.34.4 | MIT | Browser bundle |
| [cytoscape-cose-bilkent](https://www.npmjs.com/package/cytoscape-cose-bilkent/v/4.1.0) | 4.1.0 | MIT | Browser bundle |
| [cytoscape-fcose](https://www.npmjs.com/package/cytoscape-fcose/v/2.2.0) | 2.2.0 | MIT | Browser bundle |
| [d3](https://www.npmjs.com/package/d3/v/7.9.2) | 7.9.2 | ISC | Production install |
| [d3-array](https://www.npmjs.com/package/d3-array/v/2.12.1) | 2.12.1 | BSD-3-Clause | Browser bundle |
| [d3-array](https://www.npmjs.com/package/d3-array/v/3.2.5) | 3.2.5 | ISC | Browser bundle |
| [d3-axis](https://www.npmjs.com/package/d3-axis/v/3.0.1) | 3.0.1 | ISC | Browser bundle |
| [d3-brush](https://www.npmjs.com/package/d3-brush/v/3.0.1) | 3.0.1 | ISC | Production install |
| [d3-chord](https://www.npmjs.com/package/d3-chord/v/3.0.2) | 3.0.2 | ISC | Production install |
| [d3-color](https://www.npmjs.com/package/d3-color/v/3.1.1) | 3.1.1 | ISC | Browser bundle |
| [d3-contour](https://www.npmjs.com/package/d3-contour/v/4.0.3) | 4.0.3 | ISC | Production install |
| [d3-delaunay](https://www.npmjs.com/package/d3-delaunay/v/6.0.6) | 6.0.6 | ISC | Production install |
| [d3-dispatch](https://www.npmjs.com/package/d3-dispatch/v/3.0.2) | 3.0.2 | ISC | Browser bundle |
| [d3-drag](https://www.npmjs.com/package/d3-drag/v/3.0.1) | 3.0.1 | ISC | Production install |
| [d3-dsv](https://www.npmjs.com/package/d3-dsv/v/3.0.2) | 3.0.2 | ISC | Production install |
| [d3-ease](https://www.npmjs.com/package/d3-ease/v/3.0.2) | 3.0.2 | BSD-3-Clause | Production install |
| [d3-fetch](https://www.npmjs.com/package/d3-fetch/v/3.0.2) | 3.0.2 | ISC | Production install |
| [d3-force](https://www.npmjs.com/package/d3-force/v/3.0.1) | 3.0.1 | ISC | Browser bundle |
| [d3-format](https://www.npmjs.com/package/d3-format/v/3.1.3) | 3.1.3 | ISC | Browser bundle |
| [d3-geo](https://www.npmjs.com/package/d3-geo/v/3.1.2) | 3.1.2 | ISC | Production install |
| [d3-hierarchy](https://www.npmjs.com/package/d3-hierarchy/v/3.1.3) | 3.1.3 | ISC | Browser bundle |
| [d3-interpolate](https://www.npmjs.com/package/d3-interpolate/v/3.0.2) | 3.0.2 | ISC | Browser bundle |
| [d3-path](https://www.npmjs.com/package/d3-path/v/1.0.9) | 1.0.9 | BSD-3-Clause | Browser bundle |
| [d3-path](https://www.npmjs.com/package/d3-path/v/3.1.1) | 3.1.1 | ISC | Browser bundle |
| [d3-polygon](https://www.npmjs.com/package/d3-polygon/v/3.0.2) | 3.0.2 | ISC | Production install |
| [d3-quadtree](https://www.npmjs.com/package/d3-quadtree/v/3.0.2) | 3.0.2 | ISC | Browser bundle |
| [d3-random](https://www.npmjs.com/package/d3-random/v/3.0.2) | 3.0.2 | ISC | Production install |
| [d3-sankey](https://www.npmjs.com/package/d3-sankey/v/0.12.3) | 0.12.3 | BSD-3-Clause | Browser bundle |
| [d3-scale](https://www.npmjs.com/package/d3-scale/v/4.0.3) | 4.0.3 | ISC | Browser bundle |
| [d3-scale-chromatic](https://www.npmjs.com/package/d3-scale-chromatic/v/3.1.1) | 3.1.1 | ISC | Browser bundle |
| [d3-selection](https://www.npmjs.com/package/d3-selection/v/3.0.1) | 3.0.1 | ISC | Browser bundle |
| [d3-shape](https://www.npmjs.com/package/d3-shape/v/1.3.7) | 1.3.7 | BSD-3-Clause | Browser bundle |
| [d3-shape](https://www.npmjs.com/package/d3-shape/v/3.2.1) | 3.2.1 | ISC | Browser bundle |
| [d3-time](https://www.npmjs.com/package/d3-time/v/3.1.1) | 3.1.1 | ISC | Browser bundle |
| [d3-time-format](https://www.npmjs.com/package/d3-time-format/v/4.1.1) | 4.1.1 | ISC | Browser bundle |
| [d3-timer](https://www.npmjs.com/package/d3-timer/v/3.0.2) | 3.0.2 | ISC | Browser bundle |
| [d3-transition](https://www.npmjs.com/package/d3-transition/v/3.0.2) | 3.0.2 | ISC | Production install |
| [d3-zoom](https://www.npmjs.com/package/d3-zoom/v/3.0.1) | 3.0.1 | ISC | Production install |
| [dagre-d3-es](https://www.npmjs.com/package/dagre-d3-es/v/7.0.14) | 7.0.14 | MIT | Browser bundle |
| [dayjs](https://www.npmjs.com/package/dayjs/v/1.11.23) | 1.11.23 | MIT | Browser bundle |
| [delaunator](https://www.npmjs.com/package/delaunator/v/5.1.0) | 5.1.0 | ISC | Production install |
| [dictionary-en](https://www.npmjs.com/package/dictionary-en/v/4.0.0) | 4.0.0 | (MIT AND BSD) | Browser bundle |
| [dompurify](https://www.npmjs.com/package/dompurify/v/3.4.17) | 3.4.17 | (MPL-2.0 OR Apache-2.0) | Browser bundle |
| [elkjs](https://www.npmjs.com/package/elkjs/v/0.12.1) | 0.12.1 | EPL-2.0 OR GPL-3.0-or-later | Browser bundle |
| [es-toolkit](https://www.npmjs.com/package/es-toolkit/v/1.53.2) | 1.53.2 | MIT | Browser bundle |
| [hachure-fill](https://www.npmjs.com/package/hachure-fill/v/0.5.2) | 0.5.2 | MIT | Production install |
| [iconv-lite](https://www.npmjs.com/package/iconv-lite/v/0.6.3) | 0.6.3 | MIT | Production install |
| [import-meta-resolve](https://www.npmjs.com/package/import-meta-resolve/v/4.2.0) | 4.2.0 | MIT | Production install |
| [internmap](https://www.npmjs.com/package/internmap/v/1.0.1) | 1.0.1 | ISC | Production install |
| [internmap](https://www.npmjs.com/package/internmap/v/2.0.3) | 2.0.3 | ISC | Production install |
| [is-buffer](https://www.npmjs.com/package/is-buffer/v/2.0.5) | 2.0.5 | MIT | Browser bundle |
| [katex](https://www.npmjs.com/package/katex/v/0.18.10) | 0.18.10 | MIT | Browser bundle |
| [khroma](https://www.npmjs.com/package/khroma/v/2.1.0) | 2.1.0 | MIT | Browser bundle |
| [layout-base](https://www.npmjs.com/package/layout-base/v/1.0.2) | 1.0.2 | MIT | Browser bundle |
| [layout-base](https://www.npmjs.com/package/layout-base/v/2.0.1) | 2.0.1 | MIT | Browser bundle |
| [lodash-es](https://www.npmjs.com/package/lodash-es/v/4.18.1) | 4.18.1 | MIT | Browser bundle |
| [marked](https://www.npmjs.com/package/marked/v/16.4.2) | 16.4.2 | MIT | Browser bundle |
| [mermaid](https://www.npmjs.com/package/mermaid/v/12.3.0) | 12.3.0 | MIT | Browser bundle |
| [nspell](https://www.npmjs.com/package/nspell/v/2.1.5) | 2.1.5 | MIT | Browser bundle |
| [package-manager-detector](https://www.npmjs.com/package/package-manager-detector/v/1.9.0) | 1.9.0 | MIT | Production install |
| [path-data-parser](https://www.npmjs.com/package/path-data-parser/v/0.1.0) | 0.1.0 | MIT | Production install |
| [points-on-curve](https://www.npmjs.com/package/points-on-curve/v/0.2.0) | 0.2.0 | MIT | Production install |
| [points-on-path](https://www.npmjs.com/package/points-on-path/v/0.2.1) | 0.2.1 | MIT | Production install |
| [react](https://www.npmjs.com/package/react/v/19.3.1) | 19.3.1 | MIT | Browser bundle |
| [react-dom](https://www.npmjs.com/package/react-dom/v/19.3.1) | 19.3.1 | MIT | Browser bundle |
| [robust-predicates](https://www.npmjs.com/package/robust-predicates/v/3.0.3) | 3.0.3 | Unlicense | Production install |
| [roughjs](https://www.npmjs.com/package/roughjs/v/4.6.6) | 4.6.6 | MIT | Browser bundle |
| [rw](https://www.npmjs.com/package/rw/v/1.3.3) | 1.3.3 | BSD-3-Clause | Production install |
| [safer-buffer](https://www.npmjs.com/package/safer-buffer/v/2.1.2) | 2.1.2 | MIT | Production install |
| [scheduler](https://www.npmjs.com/package/scheduler/v/0.28.0) | 0.28.0 | MIT | Browser bundle |
| [style-mod](https://www.npmjs.com/package/style-mod/v/4.1.4) | 4.1.4 | MIT | Browser bundle |
| [stylis](https://www.npmjs.com/package/stylis/v/4.4.0) | 4.4.0 | MIT | Browser bundle |
| [tinyexec](https://www.npmjs.com/package/tinyexec/v/1.3.1) | 1.3.1 | MIT | Production install |
| [ts-dedent](https://www.npmjs.com/package/ts-dedent/v/2.3.0) | 2.3.0 | MIT | Browser bundle |
| [w3c-keyname](https://www.npmjs.com/package/w3c-keyname/v/2.2.8) | 2.2.8 | MIT | Browser bundle |

## MIT licence for Mermaid and KaTeX

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
