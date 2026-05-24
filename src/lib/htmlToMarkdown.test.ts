import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convertHtmlToMarkdown, insertAtSelection } from './htmlToMarkdown';

describe('convertHtmlToMarkdown', () => {
    it('drops the kramdown table-of-contents when pasting a rendered post', () => {
        const html = [
            '<h1>标题</h1>',
            '<ul id="markdown-toc">',
            '  <li><a href="#install">安装</a></li>',
            '  <li><a href="#usage">用法</a></li>',
            '</ul>',
            '<p>正文段落。</p>',
        ].join('');

        const md = convertHtmlToMarkdown(html);

        expect(md).not.toContain('安装');
        expect(md).not.toContain('用法');
        expect(md).not.toContain('#install');
        expect(md).toContain('正文段落。');
    });

    it('keeps ordinary lists intact', () => {
        const html = '<ul><li>第一项</li><li>第二项</li></ul>';

        const md = convertHtmlToMarkdown(html);

        expect(md).toContain('第一项');
        expect(md).toContain('第二项');
    });
});

describe('insertAtSelection', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.runOnlyPendingTimers();
        vi.useRealTimers();
        document.body.innerHTML = '';
    });

    function createTextarea(value: string) {
        const textarea = document.createElement('textarea');
        textarea.value = value;
        document.body.appendChild(textarea);
        return textarea;
    }

    it('inserts text using the live textarea value so concurrent typing is preserved', () => {
        const textarea = createTextarea('START\nTYPED_AFTER_UPLOAD');
        textarea.selectionStart = textarea.selectionEnd = textarea.value.length;

        let nextValue = '';
        insertAtSelection(textarea, '\n![图片](data:image/png;base64,AAA)', (value) => {
            nextValue = value;
            textarea.value = value;
        });

        expect(nextValue).toBe('START\nTYPED_AFTER_UPLOAD\n![图片](data:image/png;base64,AAA)');
    });

    it('replaces the active selection and moves the caret after the inserted text', () => {
        const textarea = createTextarea('hello world');
        textarea.selectionStart = 6;
        textarea.selectionEnd = 11;

        let nextValue = '';
        insertAtSelection(textarea, 'Raphael', (value) => {
            nextValue = value;
            textarea.value = value;
        });

        expect(nextValue).toBe('hello Raphael');

        vi.runAllTimers();

        expect(textarea.selectionStart).toBe('hello Raphael'.length);
        expect(textarea.selectionEnd).toBe('hello Raphael'.length);
    });
});
