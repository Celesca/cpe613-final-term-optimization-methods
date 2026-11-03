"""Render docs/DOCUMENTATION.md -> docs/DOCUMENTATION.pdf (Markdown + KaTeX, printed by headless Chrome)."""
import pathlib
import subprocess
import sys
import tempfile

import markdown

ROOT = pathlib.Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
KATEX = "https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9"

body = markdown.markdown(
    (DOCS / "DOCUMENTATION.md").read_text(encoding="utf-8"),
    extensions=["tables", "fenced_code", "pymdownx.arithmatex"],
    extension_configs={"pymdownx.arithmatex": {"generic": True}},
)
html = f"""<!doctype html><html><head><meta charset="utf-8">
<base href="{DOCS.as_uri()}/">
<link rel="stylesheet" href="{KATEX}/katex.min.css">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;600&family=IBM+Plex+Sans+Thai:wght@400&family=IBM+Plex+Mono&display=swap" rel="stylesheet">
<style>
@page {{ size: A4; margin: 18mm 16mm 18mm 16mm; }}
body {{ font: 10.5pt/1.5 "IBM Plex Sans", "IBM Plex Sans Thai", sans-serif; color: #1d2327; }}
h1 {{ font-size: 20pt; margin: 0 0 4pt; }}
h2 {{ font-size: 14pt; margin: 18pt 0 6pt; border-bottom: 1px solid #ddd; padding-bottom: 3pt; break-after: avoid; }}
h3 {{ font-size: 11.5pt; margin: 12pt 0 4pt; break-after: avoid; }}
h2:first-of-type {{ break-before: auto; }}
table {{ border-collapse: collapse; width: 100%; margin: 6pt 0 10pt; font-size: 9pt; break-inside: avoid; }}
th, td {{ border-bottom: 1px solid #e2e0d8; padding: 3pt 5pt; vertical-align: top; }}
th {{ background: #f3f2ed; text-align: left; }}
code {{ font-family: "IBM Plex Mono", monospace; font-size: 8.8pt; background: #f3f2ed; padding: 0 2pt; border-radius: 2pt; }}
pre {{ background: #f3f2ed; padding: 8pt; border-radius: 4pt; font-size: 8.5pt; white-space: pre-wrap; }}
pre code {{ background: none; padding: 0; }}
blockquote {{ margin: 8pt 0; padding: 4pt 10pt; border-left: 3px solid #2a6f97; background: #f2f7fa; }}
img {{ max-width: 100%; display: block; margin: 6pt auto; break-inside: avoid; }}
hr {{ border: 0; border-top: 1px solid #ddd; margin: 12pt 0; }}
.katex-display {{ margin: 6pt 0; overflow-x: auto; }}
</style></head><body>{body}
<script src="{KATEX}/katex.min.js"></script>
<script src="{KATEX}/contrib/auto-render.min.js"></script>
<script>
renderMathInElement(document.body, {{delimiters: [{{left: "\\\\[", right: "\\\\]", display: true}}, {{left: "\\\\(", right: "\\\\)", display: false}}],
  strict: false, throwOnError: false}});
document.body.dataset.ready = "1";
</script></body></html>"""

with tempfile.TemporaryDirectory() as tmp:
    src = pathlib.Path(tmp) / "doc.html"
    src.write_text(html, encoding="utf-8")
    out = DOCS / "DOCUMENTATION.pdf"
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", f"--user-data-dir={tmp}/profile",
                    "--no-pdf-header-footer", "--virtual-time-budget=20000",
                    f"--print-to-pdf={out}", src.as_uri()], check=True, stderr=subprocess.DEVNULL)
    if "--keep-html" in sys.argv:
        (DOCS / "_print.html").write_text(html, encoding="utf-8")
print("wrote", out)
