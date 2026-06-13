# Mermaid 图表支持（渲染为 PNG）— 设计

日期：2026-06-14
状态：已批准，待实现

## 背景与问题

raphael-publish 是一个 Markdown → 公众号排版工具。它用 `markdown-it` 解析、`highlight.js` 高亮代码。

当前不支持 mermaid：一个 ```` ```mermaid ```` 代码块会落到 `highlight.js`，因为 `mermaid` 不是已知语言，被当作纯文本转义后塞进 `<pre><code>`，在预览和复制结果里都只是一段源码。

博客已有 mermaid 内容（如 `_drafts/2026-05-28-openspec.md`，约 13 个 `graph TD` 流程图）。作者希望把这类文章经 raphael-publish 排版后发到公众号时，图也能正确显示。

## 目标

- ```` ```mermaid ```` 代码块在预览区渲染为图。
- 「复制」出去的 HTML 里，mermaid 图是一张 PNG `<img>`，粘贴进公众号编辑器能稳定显示。
- 其它语言的代码高亮行为完全不变。

## 非目标

- 不做内联 SVG 输出（公众号对内联 SVG 兼容性不稳定，已排除）。
- 不支持把已渲染的图再「反解」回 mermaid 源码（htmlToMarkdown 路径不涉及）。
- 不为 mermaid 图做点击定位（click-to-locate）联动。

## 约束

1. **公众号兼容**：编辑器会过滤 `<script>`，对内联 SVG 不稳定 → 最终必须是位图 PNG。这也决定了用 `htmlLabels: false`（见下）。
2. **异步**：`mermaid.render()` 与 SVG→PNG 栅格化都是异步的，而现有渲染管线是同步的（`App.tsx` 的 `useEffect` 里 `md.render` → `applyTheme` → 写入 `renderedHtml` state，再 `dangerouslySetInnerHTML`）。
3. **体积**：mermaid v11 约 2.8MB，不能进首屏 bundle，必须按需加载。

## 方案（Approach A：异步预渲染 + 缓存，主管线保持同步）

保留现有同步管线。新增一个「mermaid 源码 → PNG」缓存。fence 渲染规则读缓存：命中就输出 `<img>`，未命中输出占位符。渲染 `useEffect` 照常先同步出 HTML（瞬时），随后异步把新出现的 mermaid 块渲染、栅格化、写入缓存，并 bump 一个 `mermaidVersion` state 触发重渲染，占位符随之换成真正的图片。

### 组件

1. **`package.json`**：新增 `mermaid` 依赖。仅通过动态 `import('mermaid')` 引入，只有当文章里确实包含 mermaid 块时才加载。

2. **新建 `src/lib/mermaid.ts`**：
   - 用 `htmlLabels: false` 初始化 mermaid。这样节点标签是 SVG `<text>` 而非默认的 `<foreignObject>`——后者在多数浏览器里用 canvas 栅格化会画成空白，是 SVG→PNG 失败的主要原因。标签里的 `<br>` 仍会被 mermaid 转成换行。
   - `renderMermaidToPng(code): Promise<string>`：`mermaid.render` 出 SVG → 设定显式宽高 → 画到 2× 缩放、白底的 canvas → `canvas.toDataURL('image/png')`。
   - 模块级缓存 `Map<sourceHash, pngDataUrl>`，按源码哈希去重，避免每次按键都重新栅格化。

3. **`src/lib/markdown.ts` 自定义 fence 规则**：拦截 `info.trim() === 'mermaid'`。缓存命中 → `<img class="mermaid-img" src="...">`；未命中 → 轻量占位符（如「图表渲染中…」）。其它语言仍走原 `highlight` 回调，行为不变。

4. **`src/App.tsx`**：现有渲染 `useEffect`（依赖 `[markdownInput, activeTheme]`）增加：
   - 同步渲染后，扫描出所有 mermaid 源码；对未缓存的逐个 `await renderMermaidToPng`，写入缓存。
   - 全部完成后 `setMermaidVersion(v => v + 1)`，并把 `mermaidVersion` 加入该 effect 依赖，使视图把占位符换成 PNG。
   - 单个图渲染失败 → 该块回退为普通代码块 + `console.warn`，不阻塞其它块。

5. **`applyTheme`**：给 `.mermaid-img` 加居中、`max-width:100%` 的样式，与其它配图观感一致（按需决定是否复用通用 `<img>` 的阴影/圆角处理）。

6. **测试**：参照 `markdown.test.ts` 为 fence 规则加单测（命中缓存→`<img>`；未命中→占位符）。栅格化依赖 DOM/canvas，在 jsdom 下 mock 掉。

### 数据流

```
markdownInput
  → preprocessJekyll → preprocessMarkdown → md.render
      （mermaid fence 规则：查缓存 → <img> 或 占位符）
  → applyTheme → markElementIndexes → renderedHtml(state) → 预览/复制

异步旁路（同一 useEffect 内，渲染后）：
  扫描 mermaid 源码 → 对未缓存项 import('mermaid') + renderMermaidToPng → 写缓存
  → setMermaidVersion → effect 重跑 → 占位符替换为 PNG
```

## 错误处理与回退

- mermaid 动态加载失败 / 某个图语法错误：该块回退为普通代码块（源码可见），`console.warn` 记录，其余图与正文不受影响。
- 用户在异步渲染完成前就复制：得到的是占位符/代码块（异步通常很快），可接受。

## 交付流程

实现都在 `/home/zhu/repos/raphael-publish`（`blog-integration` 分支）。开发完成后：构建 → 在博客仓库 `script/update-submodules.sh vendor/raphael-publish` bump 子模块指针 → 部署。
