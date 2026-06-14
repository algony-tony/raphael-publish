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
