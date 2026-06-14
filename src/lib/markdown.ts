import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js';
import 'highlight.js/styles/github.css';
import { THEMES } from './themes';
import { getMermaidEntry } from './mermaid';

export const md = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: false,
    highlight: function (str, lang) {
        let codeContent = '';
        if (lang && hljs.getLanguage(lang)) {
            try {
                codeContent = hljs.highlight(str, { language: lang }).value;
            } catch (__) {
                codeContent = md.utils.escapeHtml(str);
            }
        } else {
            codeContent = md.utils.escapeHtml(str);
        }

        const dots = '<div style="margin-bottom: 12px; white-space: nowrap;"><span style="display: inline-block; width: 12px; height: 12px; border-radius: 50%; background: #ff5f56; margin-right: 6px;"></span><span style="display: inline-block; width: 12px; height: 12px; border-radius: 50%; background: #ffbd2e; margin-right: 6px;"></span><span style="display: inline-block; width: 12px; height: 12px; border-radius: 50%; background: #27c93f;"></span></div>';

        return `<pre>${dots}<code class="hljs">${codeContent}</code></pre>`;
    }
});

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

// Convert Jekyll/Liquid post syntax into plain Markdown so a blog post can be
// pasted in directly. Runs before preprocessMarkdown / md.render.
export function preprocessJekyll(content: string) {
    // 1. Strip the YAML front matter block at the very top of a post.
    content = content.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/, '');

    // 2. {% highlight LANG [linedivs] %} ... {% endhighlight %} -> fenced code block.
    content = content.replace(
        /\{%\s*highlight\s+(\S+?)(?:\s+linedivs)?\s*%\}\r?\n?([\s\S]*?)\r?\n?\{%\s*endhighlight\s*%\}/g,
        (_match, lang: string, code: string) => '```' + lang.toLowerCase() + '\n' + code + '\n```'
    );

    // 3. Remove the kramdown table-of-contents marker (`* TOC` + `{:toc}`) and any
    //    standalone kramdown inline-attribute lines.
    content = content.replace(/^[ \t]*\*[ \t]*TOC[ \t]*\r?\n/gim, '');
    content = content.replace(/^[ \t]*\{:[^}]*\}[ \t]*\r?\n?/gim, '');

    // 4. Internal {% link _posts/xxx.md %} can't be resolved without the Jekyll
    //    site context; degrade to a placeholder href so the link text survives.
    content = content.replace(/\{%\s*link\s+[^%]*?%\}(?:#[^)\s]*)?/g, '#');

    // 5. Drop data-driven {% include %} / {% assign %} lines (need Jekyll + _data).
    content = content.replace(/^[ \t]*\{%\s*(?:include|assign)\b[^%]*%\}[ \t]*\r?\n?/gim, '');

    // 6. Safety net: strip any remaining Liquid tag.
    content = content.replace(/\{%[^%]*%\}/g, '');

    return content;
}

// Avoid bold fragmentation when pasting from certain apps
export function preprocessMarkdown(content: string) {
    content = content.replace(/^[ ]{0,3}(\*[ ]*\*[ ]*\*[\* ]*)[ \t]*$/gm, '***');
    content = content.replace(/^[ ]{0,3}(-[ ]*-[ ]*-[- ]*)[ \t]*$/gm, '---');
    content = content.replace(/^[ ]{0,3}(_[ ]*_[ ]*_[_ ]*)[ \t]*$/gm, '___');
    content = content.replace(/\*\*[ \t]+\*\*/g, ' ');
    content = content.replace(/\*{4,}/g, '');
    // markdown-it may fail to open bold when content starts with punctuation/symbol
    // and `**` is attached directly to preceding text (e.g. `至**-5%**。`).
    // Insert a zero-width separator only inside opening `**...` for these cases.
    content = content.replace(
        /([^\s])\*\*([+\-＋－%％~～!！?？,，.。:：;；、\\/|@#￥$^&*_=（）()【】\[\]《》〈〉「」『』“”"'`…·][^\n*]*?)\*\*/g,
        '$1**\u200B$2**'
    );
    return content;
}

// Pull the source text of every ```mermaid block out of already-preprocessed
// markdown, using the real parser so keys match the fence renderer's token.content.
export function extractMermaidSources(markdown: string): string[] {
    return md
        .parse(markdown, {})
        .filter((t) => t.type === 'fence' && t.info.trim() === 'mermaid')
        .map((t) => t.content);
}

export function applyTheme(html: string, themeId: string) {
    const theme = THEMES.find(t => t.id === themeId) || THEMES[0];
    const style = theme.styles;

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Note: Indexing is handled separately by markElementIndexes() function
    // to keep the core rendering logic decoupled from the click-to-locate feature

    // Specific inline overrides to prevent headings from uninheriting styles
    const headingInlineOverrides: Record<string, string> = {
        strong: 'font-weight: 700; color: inherit !important; background-color: transparent !important;',
        em: 'font-style: italic; color: inherit !important; background-color: transparent !important;',
        a: 'color: inherit !important; text-decoration: none !important; border-bottom: 1px solid currentColor !important; background-color: transparent !important;',
        code: 'color: inherit !important; background-color: transparent !important; border: none !important; padding: 0 !important;',
    };


    const getSingleImageNode = (p: HTMLParagraphElement): HTMLElement | null => {
        const children = Array.from(p.childNodes).filter(n =>
            !(n.nodeType === Node.TEXT_NODE && !(n.textContent || '').trim()) &&
            !(n.nodeType === Node.ELEMENT_NODE && (n as Element).tagName === 'BR')
        );
        if (children.length !== 1) return null;
        const onlyChild = children[0];
        if (onlyChild.nodeName === 'IMG') return onlyChild as HTMLElement;
        if (onlyChild.nodeName === 'A' && onlyChild.childNodes.length === 1 && onlyChild.childNodes[0].nodeName === 'IMG') {
            return onlyChild as HTMLElement;
        }
        return null;
    };

    // Check if a paragraph contains only images (for base64 images or multiple images in one paragraph)
    const isImageOnlyParagraph = (p: HTMLParagraphElement): boolean => {
        const children = Array.from(p.childNodes).filter(n =>
            !(n.nodeType === Node.TEXT_NODE && !(n.textContent || '').trim()) &&
            !(n.nodeType === Node.ELEMENT_NODE && (n as Element).tagName === 'BR')
        );
        if (children.length === 0) return false;
        return children.every(n =>
            n.nodeName === 'IMG' ||
            (n.nodeName === 'A' && n.childNodes.length === 1 && n.childNodes[0].nodeName === 'IMG')
        );
    };

    // Merge consecutive image-only paragraphs (same parent) into pair-wise side-by-side grids.
    const paragraphSnapshot = Array.from(doc.querySelectorAll('p'));
    const processed = new Set<HTMLParagraphElement>();

    for (const paragraph of paragraphSnapshot) {
        if (!paragraph.isConnected || processed.has(paragraph)) continue;
        // Mermaid diagrams render as a single-image <p class="mermaid-figure"> but must
        // never be merged into a side-by-side image grid — keep them full-width and stacked.
        if (paragraph.classList.contains('mermaid-figure')) continue;
        if (!getSingleImageNode(paragraph) && !isImageOnlyParagraph(paragraph)) continue;

        const run: HTMLParagraphElement[] = [paragraph];
        processed.add(paragraph);

        let cursor = paragraph.nextElementSibling;
        while (cursor && cursor.tagName === 'P') {
            const p = cursor as HTMLParagraphElement;
            if (p.classList.contains('mermaid-figure')) break;
            if (!getSingleImageNode(p) && !isImageOnlyParagraph(p)) break;
            run.push(p);
            processed.add(p);
            cursor = p.nextElementSibling;
        }

        if (run.length < 2) continue;

        // Collect all images from the run
        const allImages: HTMLElement[] = [];
        run.forEach(p => {
            if (getSingleImageNode(p)) {
                const img = getSingleImageNode(p);
                if (img) allImages.push(img);
            } else if (isImageOnlyParagraph(p)) {
                const images = p.querySelectorAll('img');
                images.forEach(img => allImages.push(img as HTMLElement));
            }
        });

        // Create grid paragraphs with 2 images each
        const firstParagraph = run[0];
        let lastInserted: HTMLElement | null = null;

        for (let i = 0; i < allImages.length; i += 2) {
            const gridParagraph = doc.createElement('p');
            gridParagraph.classList.add('image-grid');
            gridParagraph.setAttribute('style', 'display: flex; justify-content: center; gap: 8px; margin: 24px 0; align-items: flex-start;');

            gridParagraph.appendChild(allImages[i]);
            if (i + 1 < allImages.length) {
                gridParagraph.appendChild(allImages[i + 1]);
            }

            if (i === 0) {
                firstParagraph.before(gridParagraph);
                lastInserted = gridParagraph;
            } else if (lastInserted) {
                lastInserted.after(gridParagraph);
                lastInserted = gridParagraph;
            }
        }

        // Remove original paragraphs
        run.forEach(p => {
            if (p.isConnected) p.remove();
        });
    }

    // Process image grids
    const paragraphs = doc.querySelectorAll('p');
    paragraphs.forEach(p => {
        const children = Array.from(p.childNodes).filter(n => !(n.nodeType === Node.TEXT_NODE && !(n.textContent || '').trim()));
        const isAllImages = children.length > 1 && children.every(n => n.nodeName === 'IMG' || (n.nodeName === 'A' && n.childNodes.length === 1 && n.childNodes[0].nodeName === 'IMG'));

        if (isAllImages) {
            p.classList.add('image-grid');
            p.setAttribute('style', 'display: flex; justify-content: center; gap: 8px; margin: 24px 0; align-items: flex-start;');

            p.querySelectorAll('img').forEach(img => {
                img.classList.add('grid-img');
                const w = 100 / children.length;
                img.setAttribute('style', `width: calc(${w}% - ${8 * (children.length - 1) / children.length}px); margin: 0; border-radius: 8px; height: auto;`);
            });
        }
    });

    Object.keys(style).forEach((selector) => {

        if (selector === 'pre code') return;
        const elements = doc.querySelectorAll(selector);
        elements.forEach(el => {
            if (selector === 'code' && el.parentElement?.tagName === 'PRE') return;
            if (el.tagName === 'IMG' && el.closest('.image-grid')) return;
            const currentStyle = el.getAttribute('style') || '';
            el.setAttribute('style', currentStyle + '; ' + style[selector as keyof typeof style]);
        });
    });

    // Tailwind preflight removes native list markers. Restore explicit markers.
    doc.querySelectorAll('ul').forEach(ul => {
        const currentStyle = ul.getAttribute('style') || '';
        ul.setAttribute('style', `${currentStyle}; list-style-type: disc !important; list-style-position: outside;`);
    });
    doc.querySelectorAll('ul ul').forEach(ul => {
        const currentStyle = ul.getAttribute('style') || '';
        ul.setAttribute('style', `${currentStyle}; list-style-type: circle !important;`);
    });
    doc.querySelectorAll('ul ul ul').forEach(ul => {
        const currentStyle = ul.getAttribute('style') || '';
        ul.setAttribute('style', `${currentStyle}; list-style-type: square !important;`);
    });
    doc.querySelectorAll('ol').forEach(ol => {
        const currentStyle = ol.getAttribute('style') || '';
        ol.setAttribute('style', `${currentStyle}; list-style-type: decimal !important; list-style-position: outside;`);
    });

    const hljsLight: Record<string, string> = {
        'hljs-comment': 'color: #6a737d; font-style: normal;',
        'hljs-quote': 'color: #6a737d; font-style: normal;',
        'hljs-keyword': 'color: #d73a49; font-weight: 600;',
        'hljs-selector-tag': 'color: #d73a49; font-weight: 600;',
        'hljs-string': 'color: #032f62;',
        'hljs-title': 'color: #6f42c1; font-weight: 600;',
        'hljs-section': 'color: #6f42c1; font-weight: 600;',
        'hljs-type': 'color: #005cc5; font-weight: 600;',
        'hljs-number': 'color: #005cc5;',
        'hljs-literal': 'color: #005cc5;',
        'hljs-built_in': 'color: #005cc5;',
        'hljs-variable': 'color: #e36209;',
        'hljs-template-variable': 'color: #e36209;',
        'hljs-tag': 'color: #22863a;',
        'hljs-name': 'color: #22863a;',
        'hljs-attr': 'color: #6f42c1;',
    };

    const codeTokens = doc.querySelectorAll('.hljs span');
    codeTokens.forEach(span => {
        let inlineStyle = span.getAttribute('style') || '';
        if (inlineStyle && !inlineStyle.endsWith(';')) inlineStyle += '; ';
        span.classList.forEach(cls => {
            if (hljsLight[cls]) {
                inlineStyle += hljsLight[cls] + '; ';
            }
        });
        if (inlineStyle) {
            span.setAttribute('style', inlineStyle);
        }
    });

    doc.querySelectorAll('pre').forEach(pre => {
        const currentStyle = pre.getAttribute('style') || '';
        pre.setAttribute(
            'style',
            `${currentStyle}; font-variant-ligatures: none; tab-size: 2;`
        );
    });

    doc.querySelectorAll('pre code, pre .hljs, .hljs').forEach(codeNode => {
        const currentStyle = codeNode.getAttribute('style') || '';
        codeNode.setAttribute(
            'style',
            `${currentStyle}; display: block; font-size: inherit !important; line-height: inherit !important; font-style: normal !important; white-space: pre; word-break: normal; overflow-wrap: normal;`
        );
    });

    const headings = doc.querySelectorAll('h1, h2, h3, h4, h5, h6');
    headings.forEach(heading => {
        Object.keys(headingInlineOverrides).forEach(tag => {
            heading.querySelectorAll(tag).forEach(node => {
                const override = headingInlineOverrides[tag];
                node.setAttribute('style', `${node.getAttribute('style') || ''}; ${override}`);
            });
        });
    });

    // Unify image look-and-feel across themes.
    doc.querySelectorAll('img').forEach(img => {
        if (img.classList.contains('mermaid-img')) return;
        const inGrid = Boolean(img.closest('.image-grid'));
        const currentStyle = img.getAttribute('style') || '';
        const appendedStyle = inGrid
            ? 'display:block; max-width:100%; height:auto; margin:0 !important; padding:8px !important; border-radius:14px !important; box-sizing:border-box; box-shadow:0 12px 28px rgba(15,23,42,0.18), 0 2px 8px rgba(15,23,42,0.12); border:1px solid rgba(255,255,255,0.75);'
            : 'display:block; width:100%; max-width:100%; height:auto; margin:30px auto !important; padding:8px !important; border-radius:14px !important; box-sizing:border-box; box-shadow:0 16px 34px rgba(15,23,42,0.22), 0 4px 10px rgba(15,23,42,0.12); border:1px solid rgba(15,23,42,0.12);';
        img.setAttribute('style', `${currentStyle}; ${appendedStyle}`);
    });

    const container = doc.createElement('div');
    container.setAttribute('style', style.container);
    container.innerHTML = doc.body.innerHTML;

    return container.outerHTML;
}
