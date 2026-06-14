# Mermaid PNG Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render ```` ```mermaid ```` code blocks in raphael-publish as PNG `<img>`s so diagrams survive a paste into the WeChat 公众号 editor.

**Architecture:** Keep the existing synchronous `md.render → applyTheme → renderedHtml` pipeline. A custom markdown-it fence rule reads a module-level source→PNG cache: cached → `<img>`, errored → code block, otherwise a placeholder. The render `useEffect` kicks off an async pass that lazy-loads mermaid, renders each new diagram to SVG, rasterizes it to a PNG data URL on a white canvas, fills the cache, and bumps a `mermaidVersion` state to swap placeholders for images.

**Tech Stack:** TypeScript, React 18, Vite, markdown-it, mermaid v11 (dynamic `import()`), Vitest + jsdom.

**Repo / workflow note:** All work happens in `/home/zhu/repos/raphael-publish` on the `blog-integration` branch. This repo lives outside the primary sandbox workspace, so `git` and `pnpm` commands here may need to run with the sandbox disabled (a write to `.git` fails with "Read-only file system" otherwise). Delivery to the blog (submodule bump + deploy) is the final, user-gated task.

**Spec:** `docs/superpowers/specs/2026-06-14-mermaid-png-support-design.md`

---

## File Structure

- **Create** `src/lib/mermaid.ts` — mermaid lazy-loader, source→PNG cache, `getMermaidEntry`, `renderMermaidToPng`, SVG-dimension parsing, SVG→PNG rasterization.
- **Modify** `src/lib/markdown.ts` — override `md.renderer.rules.fence` for `mermaid`; add `extractMermaidSources`; exclude `.mermaid-img` from the decorative `<img>` handler in `applyTheme`.
- **Modify** `src/App.tsx` — add `mermaidVersion` state; extend the render `useEffect` with the async mermaid pass.
- **Create** `src/lib/mermaid.test.ts` — unit tests for `parseSvgDimensions`.
- **Create** `src/lib/markdownMermaid.test.ts` — unit tests for the fence rule, `extractMermaidSources`, and the `applyTheme` mermaid-image rule (mermaid module mocked).
- **Modify** `package.json` / `pnpm-lock.yaml` — add `mermaid`.

---

## Task 1: Add the mermaid dependency (lazy-loaded)

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml`

- [ ] **Step 1: Install mermaid**

Run (from repo root, sandbox disabled if needed):
```bash
cd /home/zhu/repos/raphael-publish && pnpm add mermaid
```
Expected: `package.json` `dependencies` gains `"mermaid": "^11.x"`, lockfile updates, install succeeds.

- [ ] **Step 2: Verify it resolves and types are present**

Run:
```bash
cd /home/zhu/repos/raphael-publish && node -e "console.log(require('mermaid/package.json').version)"
```
Expected: prints an `11.*` version.

- [ ] **Step 3: Commit**

```bash
cd /home/zhu/repos/raphael-publish && git add package.json pnpm-lock.yaml && \
git commit -m "Add mermaid dependency for diagram rendering" \
  -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 2: `src/lib/mermaid.ts` — cache, lazy-load, render, rasterize

`parseSvgDimensions` is pure and testable under jsdom; the canvas rasterization (`svgToPng`) and `renderMermaidToPng` are browser-only and are covered by manual verification in Task 6.

**Files:**
- Create: `src/lib/mermaid.ts`
- Test: `src/lib/mermaid.test.ts`

- [ ] **Step 1: Write the failing test for `parseSvgDimensions`**

Create `src/lib/mermaid.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { parseSvgDimensions } from './mermaid';

describe('parseSvgDimensions', () => {
    it('reads width/height from the viewBox', () => {
        expect(parseSvgDimensions('<svg viewBox="0 0 400 300"></svg>')).toEqual({
            width: 400,
            height: 300,
        });
    });

    it('ignores percentage width/height and falls back to the viewBox', () => {
        const svg = '<svg width="100%" height="100%" viewBox="0 0 640 480"></svg>';
        expect(parseSvgDimensions(svg)).toEqual({ width: 640, height: 480 });
    });

    it('uses explicit pixel width/height when present', () => {
        const svg = '<svg width="500" height="350" viewBox="0 0 500 350"></svg>';
        expect(parseSvgDimensions(svg)).toEqual({ width: 500, height: 350 });
    });

    it('falls back to sane defaults when nothing is parseable', () => {
        expect(parseSvgDimensions('<svg></svg>')).toEqual({ width: 800, height: 600 });
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
cd /home/zhu/repos/raphael-publish && pnpm exec vitest run src/lib/mermaid.test.ts
```
Expected: FAIL — `parseSvgDimensions` is not exported / module not found.

- [ ] **Step 3: Implement `src/lib/mermaid.ts`**

Create `src/lib/mermaid.ts`:
```ts
// Renders ```mermaid blocks to PNG data URLs and caches them by source text.
// The cache is read synchronously by the markdown-it fence rule (see markdown.ts);
// population happens asynchronously from App's render effect.

export type MermaidEntry = { ok: true; png: string } | { ok: false };

type MermaidApi = Awaited<typeof import('mermaid')>['default'];

const cache = new Map<string, MermaidEntry>();
let mermaidPromise: Promise<MermaidApi> | null = null;
let renderCounter = 0;

function loadMermaid(): Promise<MermaidApi> {
    if (!mermaidPromise) {
        // Dynamic import => Vite splits mermaid (~2.8MB) into its own chunk,
        // loaded only when a post actually contains a diagram.
        mermaidPromise = import('mermaid').then(({ default: mermaid }) => {
            mermaid.initialize({
                startOnLoad: false,
                theme: 'default',
                // htmlLabels:false makes node labels SVG <text> instead of
                // <foreignObject>, which is what lets the SVG rasterize to PNG
                // (foreignObject draws blank on canvas in most browsers).
                flowchart: { htmlLabels: false },
            });
            return mermaid;
        });
    }
    return mermaidPromise;
}

/** Synchronous cache lookup used by the fence renderer. Keyed by trimmed source. */
export function getMermaidEntry(code: string): MermaidEntry | undefined {
    return cache.get(code.trim());
}

/** Parse pixel dimensions from a mermaid SVG string (viewBox-first). */
export function parseSvgDimensions(svg: string): { width: number; height: number } {
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const el = doc.documentElement;
    const viewBox = (el.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
    const vbW = viewBox.length === 4 ? viewBox[2] : 0;
    const vbH = viewBox.length === 4 ? viewBox[3] : 0;
    const wAttr = el.getAttribute('width') || '';
    const hAttr = el.getAttribute('height') || '';
    const wNum = parseFloat(wAttr);
    const hNum = parseFloat(hAttr);
    const width = !wNum || wAttr.includes('%') ? vbW : wNum;
    const height = !hNum || hAttr.includes('%') ? vbH : hNum;
    return { width: width || 800, height: height || 600 };
}

async function svgToPng(svg: string, scale = 2): Promise<string> {
    const { width, height } = parseSvgDimensions(svg);

    // Give the SVG explicit pixel dimensions so the raster step is deterministic.
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const el = doc.documentElement;
    el.setAttribute('width', String(width));
    el.setAttribute('height', String(height));
    const sized = new XMLSerializer().serializeToString(el);

    const src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(sized);
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('mermaid SVG failed to load as image'));
        img.src = src;
    });

    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(width * scale);
    canvas.height = Math.ceil(height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d context unavailable');
    ctx.fillStyle = '#ffffff'; // WeChat default background is white
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL('image/png');
}

/**
 * Render one mermaid source to a PNG and store it in the cache.
 * On any failure, caches an { ok:false } sentinel (so the fence rule shows a
 * code block instead) and rethrows for the caller to log.
 */
export async function renderMermaidToPng(code: string): Promise<void> {
    const key = code.trim();
    if (cache.has(key)) return;
    try {
        const mermaid = await loadMermaid();
        const id = `mermaid-render-${renderCounter++}`;
        const { svg } = await mermaid.render(id, key);
        const png = await svgToPng(svg);
        cache.set(key, { ok: true, png });
    } catch (err) {
        cache.set(key, { ok: false });
        throw err;
    }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
cd /home/zhu/repos/raphael-publish && pnpm exec vitest run src/lib/mermaid.test.ts
```
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd /home/zhu/repos/raphael-publish && git add src/lib/mermaid.ts src/lib/mermaid.test.ts && \
git commit -m "Add mermaid render+rasterize module with source→PNG cache" \
  -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 3: `markdown.ts` — fence rule + `extractMermaidSources`

**Files:**
- Modify: `src/lib/markdown.ts`
- Test: `src/lib/markdownMermaid.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/markdownMermaid.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock the mermaid module so the fence rule's cache lookups are controllable
// and no real (browser-only) rendering is attempted.
vi.mock('./mermaid', () => ({
    getMermaidEntry: vi.fn(),
    renderMermaidToPng: vi.fn(),
}));

import { getMermaidEntry } from './mermaid';
import { applyTheme, extractMermaidSources, md } from './markdown';
import { THEMES } from './themes';

const mockedGetEntry = vi.mocked(getMermaidEntry);
const FENCE = '```mermaid\ngraph TD\nA-->B\n```\n';

afterEach(() => {
    vi.clearAllMocks();
});

describe('extractMermaidSources', () => {
    it('returns the source of each mermaid fence', () => {
        const sources = extractMermaidSources(FENCE);
        expect(sources).toHaveLength(1);
        expect(sources[0]).toContain('graph TD');
    });

    it('ignores non-mermaid fences', () => {
        expect(extractMermaidSources('```js\nconst a = 1;\n```\n')).toHaveLength(0);
    });

    it('returns multiple sources in document order', () => {
        const input = '```mermaid\ngraph TD\nA-->B\n```\n\n```mermaid\ngraph LR\nC-->D\n```\n';
        const sources = extractMermaidSources(input);
        expect(sources).toHaveLength(2);
        expect(sources[0]).toContain('A-->B');
        expect(sources[1]).toContain('C-->D');
    });
});

describe('mermaid fence rendering', () => {
    it('renders a cached diagram as a data-URL <img>', () => {
        mockedGetEntry.mockReturnValue({ ok: true, png: 'data:image/png;base64,AAAA' });
        const html = md.render(FENCE);
        expect(html).toContain('class="mermaid-img"');
        expect(html).toContain('src="data:image/png;base64,AAAA"');
    });

    it('shows a placeholder while uncached', () => {
        mockedGetEntry.mockReturnValue(undefined);
        const html = md.render(FENCE);
        expect(html).toContain('mermaid-pending');
        expect(html).toContain('图表渲染中');
        expect(html).not.toContain('<img');
    });

    it('falls back to a code block when rendering errored', () => {
        mockedGetEntry.mockReturnValue({ ok: false });
        const html = md.render(FENCE);
        expect(html).toContain('<pre');
        expect(html).toContain('A--&gt;B'); // escaped source stays visible
        expect(html).not.toContain('mermaid-img');
    });

    it('leaves non-mermaid code blocks on the normal highlight path', () => {
        mockedGetEntry.mockReturnValue(undefined);
        const html = md.render('```js\nconst a = 1;\n```\n');
        expect(html).toContain('hljs');
        expect(html).not.toContain('mermaid-pending');
    });
});

describe('applyTheme mermaid image', () => {
    it('does not apply the decorative shadow treatment to mermaid images', () => {
        const html =
            '<p class="mermaid-figure"><img class="mermaid-img" src="data:image/png;base64,AAAA" /></p>';
        const styled = applyTheme(html, THEMES[0].id);
        const img = new DOMParser()
            .parseFromString(styled, 'text/html')
            .querySelector('img.mermaid-img');
        expect(img).not.toBeNull();
        expect(img!.getAttribute('style') || '').not.toContain('box-shadow');
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
cd /home/zhu/repos/raphael-publish && pnpm exec vitest run src/lib/markdownMermaid.test.ts
```
Expected: FAIL — `extractMermaidSources` is not exported; the fence still renders mermaid as a plain highlighted code block (no `mermaid-img` / `mermaid-pending`).

- [ ] **Step 3: Add the mermaid import to `markdown.ts`**

In `src/lib/markdown.ts`, add after the existing imports (the block ending with `import { THEMES } from './themes';`):
```ts
import { getMermaidEntry } from './mermaid';
```

- [ ] **Step 4: Override the fence renderer**

In `src/lib/markdown.ts`, immediately AFTER the `export const md = new MarkdownIt({ ... });` block, insert:
```ts
// Mermaid blocks render to a cached PNG <img> (see lib/mermaid.ts). Cache miss =>
// placeholder; cached error => fall back to the normal highlighted code block.
const defaultFenceRenderer =
    md.renderer.rules.fence ||
    ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    if (token.info.trim() === 'mermaid') {
        const entry = getMermaidEntry(token.content);
        if (entry && entry.ok) {
            return `<p class="mermaid-figure"><img class="mermaid-img" src="${entry.png}" alt="mermaid diagram" /></p>`;
        }
        if (entry && !entry.ok) {
            return defaultFenceRenderer(tokens, idx, options, env, self);
        }
        return `<p class="mermaid-pending" style="text-align:center;color:#8a8a8a;">图表渲染中…</p>`;
    }
    return defaultFenceRenderer(tokens, idx, options, env, self);
};
```

- [ ] **Step 5: Add `extractMermaidSources`**

In `src/lib/markdown.ts`, add this exported function (e.g. right after `preprocessMarkdown`):
```ts
// Pull the source text of every ```mermaid block out of already-preprocessed
// markdown, using the real parser so keys match the fence renderer's token.content.
export function extractMermaidSources(markdown: string): string[] {
    return md
        .parse(markdown, {})
        .filter((t) => t.type === 'fence' && t.info.trim() === 'mermaid')
        .map((t) => t.content);
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run:
```bash
cd /home/zhu/repos/raphael-publish && pnpm exec vitest run src/lib/markdownMermaid.test.ts
```
Expected: the `extractMermaidSources` and fence tests PASS. The `applyTheme mermaid image` test still FAILS (box-shadow is currently applied) — fixed in Task 4.

- [ ] **Step 7: Commit**

```bash
cd /home/zhu/repos/raphael-publish && git add src/lib/markdown.ts src/lib/markdownMermaid.test.ts && \
git commit -m "Render mermaid fences as cached PNG images" \
  -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 4: `applyTheme` — exclude mermaid images from the decorative handler

The themed `img` selector already gives mermaid images `max-width:100%`, centering, and a border-radius. The generic decorative loop, however, forces `width:100%` + a heavy box-shadow, which over-scales and over-decorates a diagram. Skip it for `.mermaid-img`.

**Files:**
- Modify: `src/lib/markdown.ts`
- Test: `src/lib/markdownMermaid.test.ts` (already written in Task 3)

- [ ] **Step 1: Confirm the failing test**

Run:
```bash
cd /home/zhu/repos/raphael-publish && pnpm exec vitest run src/lib/markdownMermaid.test.ts -t "decorative shadow"
```
Expected: FAIL — the mermaid image style currently contains `box-shadow`.

- [ ] **Step 2: Skip `.mermaid-img` in the decorative loop**

In `src/lib/markdown.ts`, find the "Unify image look-and-feel across themes." block:
```ts
    doc.querySelectorAll('img').forEach(img => {
        const inGrid = Boolean(img.closest('.image-grid'));
```
and insert a guard as the first line of the callback:
```ts
    doc.querySelectorAll('img').forEach(img => {
        if (img.classList.contains('mermaid-img')) return;
        const inGrid = Boolean(img.closest('.image-grid'));
```

- [ ] **Step 3: Run the test to verify it passes**

Run:
```bash
cd /home/zhu/repos/raphael-publish && pnpm exec vitest run src/lib/markdownMermaid.test.ts
```
Expected: PASS (all tests in the file).

- [ ] **Step 4: Run the full unit suite for no regressions**

Run:
```bash
cd /home/zhu/repos/raphael-publish && pnpm test
```
Expected: PASS — existing `markdown.test.ts`, `mermaid.test.ts`, `markdownMermaid.test.ts`, and the other suites all green.

- [ ] **Step 5: Commit**

```bash
cd /home/zhu/repos/raphael-publish && git add src/lib/markdown.ts && \
git commit -m "Keep decorative image styling off mermaid diagrams" \
  -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 5: `App.tsx` — async mermaid render pass

App.tsx has no test harness (no React Testing Library configured), so this task is validated by a TypeScript build. End-to-end behavior is verified in Task 6.

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Extend the markdown import**

In `src/App.tsx`, change:
```ts
import { md, preprocessJekyll, preprocessMarkdown, applyTheme } from './lib/markdown';
```
to:
```ts
import { md, preprocessJekyll, preprocessMarkdown, applyTheme, extractMermaidSources } from './lib/markdown';
import { getMermaidEntry, renderMermaidToPng } from './lib/mermaid';
```

- [ ] **Step 2: Add the `mermaidVersion` state**

In `src/App.tsx`, immediately after:
```ts
    const [activeTheme, setActiveTheme] = useState(THEMES[0].id);
```
add:
```ts
    const [mermaidVersion, setMermaidVersion] = useState(0);
```

- [ ] **Step 3: Replace the render effect with the async-aware version**

In `src/App.tsx`, replace this effect:
```ts
    useEffect(() => {
        // Core rendering: markdown → HTML → styled HTML
        const rawHtml = md.render(preprocessMarkdown(preprocessJekyll(markdownInput)));
        const styledHtml = applyTheme(rawHtml, activeTheme);

        // Enhancement layer: add index markers for click-to-locate
        // This is decoupled from core rendering logic
        const indexedHtml = markElementIndexes(styledHtml);

        setRenderedHtml(indexedHtml);
    }, [markdownInput, activeTheme]);
```
with:
```ts
    useEffect(() => {
        // Core rendering: markdown → HTML → styled HTML
        const processed = preprocessMarkdown(preprocessJekyll(markdownInput));
        const rawHtml = md.render(processed);
        const styledHtml = applyTheme(rawHtml, activeTheme);

        // Enhancement layer: add index markers for click-to-locate
        // This is decoupled from core rendering logic
        const indexedHtml = markElementIndexes(styledHtml);

        setRenderedHtml(indexedHtml);

        // Async pass: render any not-yet-cached mermaid diagrams to PNG, then
        // bump mermaidVersion so this effect re-runs and the fence rule swaps
        // placeholders for <img>. Cached (ok or errored) sources are skipped,
        // so this converges and never loops.
        const pending = extractMermaidSources(processed).filter(
            (src) => getMermaidEntry(src) === undefined
        );
        if (pending.length === 0) return;

        let cancelled = false;
        (async () => {
            for (const code of pending) {
                try {
                    await renderMermaidToPng(code);
                } catch (err) {
                    console.warn('[mermaid] render failed:', err);
                }
            }
            if (!cancelled) setMermaidVersion((v) => v + 1);
        })();
        return () => {
            cancelled = true;
        };
    }, [markdownInput, activeTheme, mermaidVersion]);
```

- [ ] **Step 4: Type-check + build**

Run:
```bash
cd /home/zhu/repos/raphael-publish && pnpm build
```
Expected: `tsc -b` passes (no type errors) and `vite build` produces `dist/`, including a separate mermaid chunk.

- [ ] **Step 5: Commit**

```bash
cd /home/zhu/repos/raphael-publish && git add src/App.tsx && \
git commit -m "Render mermaid diagrams asynchronously in the preview pipeline" \
  -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 6: Manual end-to-end verification

**Files:** none (manual)

- [ ] **Step 1: Start the dev server**

Run:
```bash
cd /home/zhu/repos/raphael-publish && pnpm dev
```
Expected: Vite serves on a local URL (e.g. http://localhost:5173).

- [ ] **Step 2: Paste a post with mermaid and observe the swap**

In the editor, paste the body of `/home/zhu/repos/algony-tony.github.io/_drafts/2026-05-28-openspec.md` (or at minimum one ```` ```mermaid graph TD ```` block).
Expected: each diagram briefly shows "图表渲染中…", then becomes a rendered flowchart image. Chinese labels, `<br>` line breaks, and `#60;`/`#62;` (`<`/`>`) entities display correctly.

- [ ] **Step 3: Verify the copied output contains a PNG**

Click the copy button, then paste into a plain-text-friendly target (or inspect via DevTools console):
```js
await navigator.clipboard.read() // confirm a text/html item
```
Expected: the copied HTML contains `<img ... src="data:image/png;base64,...">` for each diagram (not a `<pre>` code block). Pasting into the WeChat 公众号 editor shows the diagrams as images.

- [ ] **Step 4: Verify error fallback**

Paste a syntactically invalid diagram, e.g.:
````
```mermaid
graph TD
A --> --> B
```
````
Expected: after the async attempt, the block renders as a normal code block showing the source (not a stuck "图表渲染中…" placeholder); a `[mermaid] render failed` warning appears in the console.

- [ ] **Step 5: Stop the dev server** (Ctrl-C).

No commit for this task.

---

## Task 7: Build artifact + submodule delivery (user-gated)

The blog embeds raphael-publish as a git submodule tracking `origin/blog-integration`. Bumping it requires the raphael commits to be pushed first. **Pushing and deploying are outward-facing actions — do them only on the user's explicit go-ahead.**

**Files:** (blog repo) `vendor/raphael-publish` pointer

- [ ] **Step 1: Confirm the working tree is clean and tests pass**

```bash
cd /home/zhu/repos/raphael-publish && git status -sb && pnpm test
```
Expected: clean tree on `blog-integration`, all tests green.

- [ ] **Step 2: Push the raphael-publish commits** *(ask the user first)*

```bash
cd /home/zhu/repos/raphael-publish && git push origin blog-integration
```

- [ ] **Step 3: Bump the submodule pointer in the blog repo**

```bash
cd /home/zhu/repos/algony-tony.github.io && script/update-submodules.sh vendor/raphael-publish && git diff --cached
```
Expected: `vendor/raphael-publish` advances to the new `blog-integration` HEAD; review the staged pointer bump.

- [ ] **Step 4: Commit the bump in the blog repo**

```bash
cd /home/zhu/repos/algony-tony.github.io && \
git commit -m "Bump raphael-publish: render mermaid diagrams as PNG for 公众号" \
  -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Deploy** *(manual, per CLAUDE.md — user runs it)*

The blog's tool page rebuilds raphael via `script/build-raphael.sh --force` during `script/deploy-push-gh-pages.sh`. Leave the actual deploy to the user.
