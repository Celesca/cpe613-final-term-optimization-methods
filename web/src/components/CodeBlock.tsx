"use client";
import { type ReactNode, useState } from "react";
import snippets from "@/data/code_snippets.json";

export type SnippetId = keyof typeof snippets;

const KEYWORDS = new Set("and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield".split(" "));
const BUILTINS = new Set("abs any all bool dict enumerate float int len list max min print range reversed round set sorted str sum tuple zip self".split(" "));
// strings (incl. f/r prefixes) | comments | numbers | identifiers | anything else
const TOKEN = /([rRfFbB]{0,2}"(?:\\.|[^"\\])*"|[rRfFbB]{0,2}'(?:\\.|[^'\\])*')|(#.*)|(\b\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?\b)|([A-Za-z_]\w*)|([\s\S])/g;

/** Tiny Python highlighter (one line at a time; no multi-line strings in the excerpts). */
function highlight(line: string): ReactNode[] {
  const out: ReactNode[] = [];
  let m: RegExpExecArray | null, i = 0;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(line))) {
    const [tok, str, com, num, ident] = m;
    let cls: string | undefined;
    if (str) cls = "tk-str";
    else if (com) cls = "tk-com";
    else if (num) cls = "tk-num";
    else if (ident) {
      if (KEYWORDS.has(ident)) cls = "tk-kw";
      else if (BUILTINS.has(ident)) cls = "tk-bi";
      else if (line[TOKEN.lastIndex] === "(") cls = "tk-fn";
    }
    out.push(cls ? <span key={i++} className={cls}>{tok}</span> : tok);
  }
  return out;
}

export function CodeTabs({ items }: { items: { id: SnippetId; label: string }[] }) {
  const [active, setActive] = useState(0);
  const [copied, setCopied] = useState(false);
  const snip = snippets[items[active].id];
  const lines = snip.code.split("\n");
  return (
    <div className="code">
      <div className="code-head">
        <div className="code-tabs" role="tablist">
          {items.map((it, i) => (
            <button key={it.id} role="tab" aria-selected={i === active} className={i === active ? "active" : ""}
              onClick={() => { setActive(i); setCopied(false); }}>{it.label}</button>
          ))}
        </div>
        <span className="code-file">{snip.file}:{snip.startLine}–{snip.endLine}</span>
        <button className="code-copy" onClick={() => {
          navigator.clipboard?.writeText(snip.code).then(() => setCopied(true), () => {});
        }}>{copied ? "Copied" : "Copy"}</button>
      </div>
      <pre className="code-body"><code>
        {lines.map((l, i) => (
          <span className="code-line" key={i}>
            <span className="ln" aria-hidden>{snip.startLine + i}</span>
            <span>{highlight(l)}{"\n"}</span>
          </span>
        ))}
      </code></pre>
    </div>
  );
}
