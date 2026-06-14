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
