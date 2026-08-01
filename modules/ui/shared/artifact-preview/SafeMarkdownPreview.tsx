import { Fragment, type ReactNode } from "react";

const INLINE_TOKEN_PATTERN =
  /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|!\[[^\]\n]*\]\([^\n)]*\)|\[[^\]\n]+\]\([^\n)]*\)|\*[^*\n]+\*|_[^_\n]+_)/g;

function safeLinkTarget(value: string): string | undefined {
  const candidate = value.trim();
  if (!candidate || candidate.length > 2_048) return undefined;
  try {
    const url = new URL(candidate);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username ||
      url.password
    ) {
      return undefined;
    }
    return url.href;
  } catch {
    return undefined;
  }
}

function inlineMarkdown(value: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  INLINE_TOKEN_PATTERN.lastIndex = 0;
  while ((match = INLINE_TOKEN_PATTERN.exec(value)) !== null) {
    if (match.index > cursor) nodes.push(value.slice(cursor, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${match.index}`;
    const image = /^!\[([^\]]*)\]\((.*)\)$/.exec(token);
    const link = /^\[([^\]]+)\]\((.*)\)$/.exec(token);
    if (image) {
      nodes.push(
        <span className="artifact-preview__markdown-image-note" key={key}>
          Image preview omitted{image[1] ? `: ${image[1]}` : ""}
        </span>,
      );
    } else if (link) {
      const target = safeLinkTarget(link[2]);
      nodes.push(
        target ? (
          <a href={target} target="_blank" rel="noopener noreferrer" key={key}>
            {link[1]}
          </a>
        ) : (
          <span key={key}>{link[1]}</span>
        ),
      );
    } else if (token.startsWith("`")) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**") || token.startsWith("__")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    cursor = match.index + token.length;
  }
  if (cursor < value.length) nodes.push(value.slice(cursor));
  return nodes;
}

function isBlockStart(line: string): boolean {
  return (
    /^\s*```/.test(line) ||
    /^#{1,6}\s+/.test(line) ||
    /^\s*[-+*]\s+/.test(line) ||
    /^\s*\d+\.\s+/.test(line) ||
    /^\s*>\s?/.test(line) ||
    /^\s*(?:---+|___+|\*\*\*+)\s*$/.test(line)
  );
}

export function SafeMarkdownPreview({ markdown }: { readonly markdown: string }) {
  const lines = markdown.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    if (/^\s*```/.test(line)) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*```/.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(
        <pre key={`code-${index}`}><code>{code.join("\n")}</code></pre>,
      );
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const content = inlineMarkdown(heading[2], `heading-${index}`);
      const level = heading[1].length;
      blocks.push(
        level === 1 ? <h1 key={index}>{content}</h1> :
        level === 2 ? <h2 key={index}>{content}</h2> :
        level === 3 ? <h3 key={index}>{content}</h3> :
        level === 4 ? <h4 key={index}>{content}</h4> :
        level === 5 ? <h5 key={index}>{content}</h5> :
        <h6 key={index}>{content}</h6>,
      );
      index += 1;
      continue;
    }
    if (/^\s*(?:---+|___+|\*\*\*+)\s*$/.test(line)) {
      blocks.push(<hr key={`rule-${index}`} />);
      index += 1;
      continue;
    }
    if (/^\s*[-+*]\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (index < lines.length) {
        const item = /^\s*[-+*]\s+(.+)$/.exec(lines[index]);
        if (!item) break;
        items.push(<li key={index}>{inlineMarkdown(item[1], `list-${index}`)}</li>);
        index += 1;
      }
      blocks.push(<ul key={`list-${index}`}>{items}</ul>);
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (index < lines.length) {
        const item = /^\s*\d+\.\s+(.+)$/.exec(lines[index]);
        if (!item) break;
        items.push(<li key={index}>{inlineMarkdown(item[1], `ordered-${index}`)}</li>);
        index += 1;
      }
      blocks.push(<ol key={`ordered-${index}`}>{items}</ol>);
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^\s*>\s?/, ""));
        index += 1;
      }
      blocks.push(
        <blockquote key={`quote-${index}`}>
          {inlineMarkdown(quote.join(" "), `quote-${index}`)}
        </blockquote>,
      );
      continue;
    }
    const paragraph: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      (paragraph.length === 0 || !isBlockStart(lines[index]))
    ) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push(
      <p key={`paragraph-${index}`}>
        {inlineMarkdown(paragraph.join(" "), `paragraph-${index}`)}
      </p>,
    );
  }

  return (
    <div className="artifact-preview__markdown">
      {blocks.map((block, blockIndex) => (
        <Fragment key={blockIndex}>{block}</Fragment>
      ))}
    </div>
  );
}
