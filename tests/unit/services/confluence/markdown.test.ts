import { describe, it, expect } from 'vitest';
import {
  markdownToConfluenceStorage,
  applyInlineFormatting,
} from '../../../../src/services/confluence/markdown.js';

describe('markdownToConfluenceStorage', () => {
  it('converts ATX headings to HTML heading tags', () => {
    const md = '# Heading 1\n## Heading 2\n### Heading 3\n#### Heading 4\n##### Heading 5\n###### Heading 6';
    const result = markdownToConfluenceStorage(md);
    expect(result).toContain('<h1>Heading 1</h1>');
    expect(result).toContain('<h2>Heading 2</h2>');
    expect(result).toContain('<h3>Heading 3</h3>');
    expect(result).toContain('<h4>Heading 4</h4>');
    expect(result).toContain('<h5>Heading 5</h5>');
    expect(result).toContain('<h6>Heading 6</h6>');
  });

  it('converts fenced code blocks to Confluence code macros', () => {
    const md = '```typescript\nconst x = 1;\n```';
    const result = markdownToConfluenceStorage(md);
    expect(result).toContain('ac:name="code"');
    expect(result).toContain('ac:name="language">typescript</ac:parameter>');
    expect(result).toContain('<![CDATA[const x = 1;]]>');
  });

  it('uses "none" as language when no language is specified on a code fence', () => {
    const md = '```\nsome code\n```';
    const result = markdownToConfluenceStorage(md);
    expect(result).toContain('ac:name="language">none</ac:parameter>');
  });

  it('escapes CDATA end-sequences inside code blocks', () => {
    const md = '```\nfoo ]]> bar\n```';
    const result = markdownToConfluenceStorage(md);
    expect(result).toContain(']]]]><![CDATA[>');
    expect(result).not.toContain(']]>]]>');
  });

  it('converts horizontal rules', () => {
    const md = '---';
    const result = markdownToConfluenceStorage(md);
    expect(result).toContain('<hr/>');
  });

  it('wraps ordinary text lines in paragraph tags', () => {
    const md = 'Hello world';
    const result = markdownToConfluenceStorage(md);
    expect(result).toBe('<p>Hello world</p>');
  });

  it('preserves blank lines as empty strings', () => {
    const md = 'Line 1\n\nLine 2';
    const result = markdownToConfluenceStorage(md);
    expect(result).toBe('<p>Line 1</p>\n\n<p>Line 2</p>');
  });

  it('escapes XML special characters in regular text', () => {
    const md = 'Use <div> & "quotes"';
    const result = markdownToConfluenceStorage(md);
    expect(result).toContain('&lt;div&gt;');
    expect(result).toContain('&amp;');
  });

  it('does NOT escape XML characters inside code blocks', () => {
    const md = '```\n<div> & "quotes"\n```';
    const result = markdownToConfluenceStorage(md);
    expect(result).toContain('<div> & "quotes"');
  });

  it('closes unclosed code blocks (malformed input)', () => {
    const md = '```python\nprint("hello")';
    const result = markdownToConfluenceStorage(md);
    expect(result).toContain('ac:name="code"');
    expect(result).toContain('print("hello")');
  });

  it('applies inline formatting inside headings', () => {
    const md = '## A **bold** heading';
    const result = markdownToConfluenceStorage(md);
    expect(result).toBe('<h2>A <strong>bold</strong> heading</h2>');
  });

  it('applies inline formatting inside paragraphs', () => {
    const md = 'Some **bold** and *italic* and `code` text';
    const result = markdownToConfluenceStorage(md);
    expect(result).toBe('<p>Some <strong>bold</strong> and <em>italic</em> and <code>code</code> text</p>');
  });
});

describe('applyInlineFormatting', () => {
  it('converts bold syntax to <strong>', () => {
    expect(applyInlineFormatting('**bold**')).toBe('<strong>bold</strong>');
  });

  it('converts italic syntax to <em>', () => {
    expect(applyInlineFormatting('*italic*')).toBe('<em>italic</em>');
  });

  it('converts inline code to <code>', () => {
    expect(applyInlineFormatting('`code`')).toBe('<code>code</code>');
  });

  it('handles mixed inline formatting', () => {
    expect(applyInlineFormatting('**bold** and *italic* and `code`'))
      .toBe('<strong>bold</strong> and <em>italic</em> and <code>code</code>');
  });

  it('returns plain text unchanged', () => {
    expect(applyInlineFormatting('just text')).toBe('just text');
  });
});
