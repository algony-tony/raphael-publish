import { describe, expect, it } from 'vitest';
import { applyTheme, md, preprocessJekyll, preprocessMarkdown } from './markdown';

function renderMarkdown(markdown: string) {
    return md.render(preprocessMarkdown(markdown));
}

describe('preprocessMarkdown', () => {
    it('keeps bold rendering intact next to trailing punctuation', () => {
        const html = renderMarkdown('2025年初，伦敦黄金市场的一个月拆借利率一度升至**5%**。');

        expect(html).toContain('<strong>5%</strong>。');
        expect(html).not.toContain('**5%**');
    });

    it('repairs bold segments that start with a symbol and attach to previous text', () => {
        const html = renderMarkdown('利率变化至**-5%**。');
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const strong = doc.querySelector('strong');

        expect(strong?.textContent?.replace(/\u200B/g, '')).toBe('-5%');
    });

    it('does not merge separate bold blocks across blank lines', () => {
        const html = renderMarkdown('**5 %**\n\n**5%**');
        const doc = new DOMParser().parseFromString(html, 'text/html');

        expect(doc.querySelectorAll('strong')).toHaveLength(2);
    });
});

describe('preprocessJekyll', () => {
    it('strips the YAML front matter at the top of a post', () => {
        const input = '---\nlayout: post\ntitle: 标题\ntags: a b\n---\n\n正文开始。';
        const out = preprocessJekyll(input);

        expect(out).not.toContain('layout: post');
        expect(out).not.toContain('---');
        expect(out.trim()).toBe('正文开始。');
    });

    it('converts a {% highlight LANG linedivs %} block into a fenced code block', () => {
        const input = '{% highlight bash linedivs %}\nnpm i -g @openai/codex\ncodex\n{% endhighlight %}';
        const out = preprocessJekyll(input);

        expect(out).toBe('```bash\nnpm i -g @openai/codex\ncodex\n```');
    });

    it('handles a highlight block without the linedivs flag and lowercases the language', () => {
        const input = '{% highlight Vim %}\n:wq\n{% endhighlight %}';
        const out = preprocessJekyll(input);

        expect(out).toBe('```vim\n:wq\n```');
    });

    it('actually renders converted highlight blocks as code via the full pipeline', () => {
        const html = md.render(preprocessMarkdown(preprocessJekyll(
            '{% highlight python linedivs %}\nprint("hi")\n{% endhighlight %}'
        )));

        expect(html).toContain('<pre>');
        expect(html).toContain('<code');
        expect(html).not.toContain('highlight');
    });

    it('removes the kramdown TOC marker lines', () => {
        const input = '# 标题\n\n* TOC\n{:toc}\n\n正文。';
        const out = preprocessJekyll(input);

        expect(out).not.toContain('TOC');
        expect(out).not.toContain('{:toc}');
        expect(out).toContain('正文。');
    });

    it('degrades an internal {% link %} to a placeholder href while keeping link text', () => {
        const input = '见 [本站链接]({% link _posts/2022-12-04-linear-programming.md %}#匈牙利法)';
        const out = preprocessJekyll(input);

        expect(out).not.toContain('{% link');
        expect(out).toContain('[本站链接](#)');
    });

    it('drops data-driven include and assign lines', () => {
        const input = '正文\n{% assign csvdata = site.data.AFRE202110 %}\n{% include table.html %}\n结尾';
        const out = preprocessJekyll(input);

        expect(out).not.toContain('assign');
        expect(out).not.toContain('include');
        expect(out).toContain('正文');
        expect(out).toContain('结尾');
    });

    it('strips any remaining unknown Liquid tag as a safety net', () => {
        const input = '前 {% unknown_tag foo %} 后';
        const out = preprocessJekyll(input);

        expect(out).not.toContain('{%');
        expect(out).toContain('前');
        expect(out).toContain('后');
    });
});

describe('applyTheme', () => {
    it('groups consecutive standalone images into an image grid', () => {
        const html = '<p><img src="a.png" /></p><p><img src="b.png" /></p>';
        const themed = applyTheme(html, 'apple');
        const doc = new DOMParser().parseFromString(themed, 'text/html');
        const grid = doc.querySelector('.image-grid');

        expect(grid).not.toBeNull();
        expect(grid?.querySelectorAll('img')).toHaveLength(2);
    });

    it('keeps highlighted comments non-italic for apple', () => {
        const rawHtml = renderMarkdown('```javascript\n// 中文注释\nconst raphael = 1;\n```');
        const themed = applyTheme(rawHtml, 'apple');
        const doc = new DOMParser().parseFromString(themed, 'text/html');
        const code = doc.querySelector('pre code');
        const comment = doc.querySelector('.hljs-comment');

        expect(code?.getAttribute('style')).toContain('font-style: normal !important;');
        expect(code?.getAttribute('style')).toContain('white-space: pre;');
        expect(comment?.getAttribute('style')).toContain('font-style: normal;');
    });

    it('does not override bloomberg block-code font inheritance', () => {
        const rawHtml = renderMarkdown('```javascript\n// terminal theme\nconst raphael = 1;\n```');
        const themed = applyTheme(rawHtml, 'bloomberg');
        const doc = new DOMParser().parseFromString(themed, 'text/html');
        const container = doc.querySelector('body > div');
        const pre = doc.querySelector('pre');
        const code = doc.querySelector('pre code');

        expect(container?.getAttribute('style')).toContain('"Courier New"');
        expect(pre?.getAttribute('style')).not.toContain('font-family:');
        expect(code?.getAttribute('style')).not.toContain('font-family:');
        expect(themed).not.toContain('"SF Mono", "Cascadia Code", "Fira Code", Consolas, Menlo, Monaco, monospace');
    });
});
