import { describe, expect, it } from 'vitest';
import { MERMAID_INIT_CONFIG, decodeSvgTextEntities, parseSvgDimensions } from './mermaid';

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

describe('MERMAID_INIT_CONFIG', () => {
    // mermaid v11 ignores the deprecated flowchart.htmlLabels key; htmlLabels must be
    // disabled at the top level or diagrams with <br> labels fail to rasterize to PNG.
    it('disables HTML labels at the top level', () => {
        expect(MERMAID_INIT_CONFIG.htmlLabels).toBe(false);
    });
});

describe('decodeSvgTextEntities', () => {
    it('decodes numeric character references mermaid leaves undecoded in SVG text', () => {
        const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>x &amp;#60;id&amp;#62; y</text></svg>';
        const out = decodeSvgTextEntities(svg);
        const text = new DOMParser().parseFromString(out, 'image/svg+xml').querySelector('text');
        expect(text?.textContent).toBe('x <id> y');
    });

    it('leaves text without entities unchanged', () => {
        const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>hello 世界</text></svg>';
        const out = decodeSvgTextEntities(svg);
        const text = new DOMParser().parseFromString(out, 'image/svg+xml').querySelector('text');
        expect(text?.textContent).toBe('hello 世界');
    });
});
