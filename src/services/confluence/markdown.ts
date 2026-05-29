// ---------------------------------------------------------------------------
// Markdown → Confluence storage format converter
// ---------------------------------------------------------------------------

/**
 * Convert a Markdown string to Confluence storage format (XHTML).
 *
 * Handles the most common Markdown constructs found in knowledge-base files:
 *  - ATX headings (`#` through `######`)
 *  - Fenced code blocks (``` … ```) → Confluence `code` macro
 *  - Horizontal rules (`---`)
 *  - Bold (`**text**`) and italic (`*text*`) inline emphasis
 *  - Inline code (`` `code` ``)
 *  - Ordinary paragraphs (blank-line separated)
 *
 * Complex constructs (tables, nested lists, HTML) are left as-is inside
 * paragraph tags — they will be visible as plain text in Confluence but are
 * fully indexed by Rovo's knowledge engine.
 */
export function markdownToConfluenceStorage(markdown: string): string {
  const lines = markdown.split('\n');
  const output: string[] = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];
  let codeLang = 'none';

  for (const rawLine of lines) {
    // Code block fence
    const fenceMatch = rawLine.match(/^```(\w*)$/);
    if (fenceMatch) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeLang = fenceMatch[1] || 'none';
        codeLines = [];
      } else {
        inCodeBlock = false;
        // Escape CDATA end-sequences inside the code body
        const escaped = codeLines.join('\n').replace(/]]>/g, ']]]]><![CDATA[>');
        output.push(
          `<ac:structured-macro ac:name="code" ac:schema-version="1">` +
          `<ac:parameter ac:name="language">${codeLang}</ac:parameter>` +
          `<ac:plain-text-body><![CDATA[${escaped}]]></ac:plain-text-body>` +
          `</ac:structured-macro>`
        );
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(rawLine);
      continue;
    }

    // Escape XML special characters for content outside code blocks
    const line = rawLine
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // ATX headings
    const hMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (hMatch) {
      const level = hMatch[1].length;
      output.push(`<h${level}>${applyInlineFormatting(hMatch[2])}</h${level}>`);
      continue;
    }

    // Horizontal rule
    if (/^-{3,}$/.test(line.trim())) {
      output.push('<hr/>');
      continue;
    }

    // Blank line — used as paragraph separator; emit as-is to be collapsed below
    if (!line.trim()) {
      output.push('');
      continue;
    }

    // Paragraph line
    output.push(`<p>${applyInlineFormatting(line)}</p>`);
  }

  // Close any unclosed code block (malformed input)
  if (inCodeBlock) {
    const escaped = codeLines.join('\n').replace(/]]>/g, ']]]]><![CDATA[>');
    output.push(
      `<ac:structured-macro ac:name="code" ac:schema-version="1">` +
      `<ac:parameter ac:name="language">none</ac:parameter>` +
      `<ac:plain-text-body><![CDATA[${escaped}]]></ac:plain-text-body>` +
      `</ac:structured-macro>`
    );
  }

  return output.join('\n');
}

/** Apply inline Markdown formatting (bold, italic, inline code) to an already XML-escaped line. */
export function applyInlineFormatting(line: string): string {
  return line
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}
