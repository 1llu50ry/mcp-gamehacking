"""What a public decomp says about AI and contributions, read before it's forked.

Every project works differently: some don't want AI-made code at all, others don't want drive-by contributions
from people who put no work into them. decomp.wtf shows what the project's own README, CONTRIBUTING and agent
files say before anything is cloned: the lines about AI, word for word, and which way they lean. A partial clone
(no file contents except the few read) makes it work for any git host and costs a second or two.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import tempfile

# files a project states its rules in, at the top, in .github/ or docs/
_POLICY_FILE = re.compile(r"^(?:\.github/|docs/)?(?:readme|contributing|contribute|code_of_conduct|agents|claude|"
                          r"gemini|ai|ai[-_]?policy|policy|guidelines)(?:\.(?:md|markdown|txt|rst))?$", re.IGNORECASE)
# mentions of AI ("AI" in capitals only: "said", "mail"...)
_AI = re.compile(r"\bA\.?I\b|\bLLMs?\b|\blarge language models?\b|\bChatGPT\b|\bCopilot\b|\bClaude\b|\bCodex\b|"
                 r"\bGPT-?\d|\bGemini\b|\bmachine[- ]generated\b|\bgenerative\b|\bartificial intelligence\b|\bvibe[- ]?cod")
_NO = re.compile(r"\b(?:no|not|never|don'?t|do not|won'?t|will not|cannot|can'?t|prohibit\w*|ban(?:ned|s)?|forbid\w*|"
                 r"disallow\w*|reject\w*|refus\w*|unwelcome|without|closed|removed|deleted)\b", re.IGNORECASE)
_YES = re.compile(r"\b(?:welcome\w*|allowed|accept\w*|encourag\w*|fine|okay|ok|permitted|may use|can use|feel free)\b", re.IGNORECASE)


def _git(*args: str, cwd: str | None = None, timeout: int = 90) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-c", "safe.directory=*", *args], cwd=cwd, capture_output=True, text=True,
                          encoding="utf-8", errors="replace", timeout=timeout, stdin=subprocess.DEVNULL,
                          env={"GIT_TERMINAL_PROMPT": "0", "PATH": os.environ.get("PATH", "")})


def lines_about_ai(text: str, limit: int = 8) -> list[str]:
    """The sentences of a text that mention AI, trimmed, without markdown decoration."""
    out = []
    for para in re.split(r"\n\s*\n", text):
        flat = re.sub(r"\s+", " ", re.sub(r"[*_`>#]+|\[([^\]]*)\]\([^)]*\)", r"\1", para)).strip(" -")
        for sentence in re.split(r"(?<=[.!?])\s+(?=[A-Z])", flat):
            if sentence.count(" - ") >= 3 or sentence.count(" | ") >= 3:  # a table of contents, a table row
                continue
            if _AI.search(sentence) and len(sentence) > 12:
                out.append(sentence[:400])
                if len(out) >= limit:
                    return out
    return out


def lean(lines: list[str]) -> str:
    """no | rules | yes | unclear | silent, from what the lines say (a hint: the lines themselves are what to read).
    "rules": AI is allowed, with limits of the project's ("acceptable ... refrain from letting AI name fields")."""
    if not lines:
        return "silent"
    yes = any(_YES.search(ln) and not _NO.search(ln) for ln in lines)
    no = any(_NO.search(ln) for ln in lines)
    return "rules" if yes and no else "no" if no else "yes" if yes else "unclear"


def check(url: str) -> dict:
    """{"files": [...], "lines": [{"file", "text"}], "lean": no|yes|unclear|silent, "error": str|None} for a git
    repository address (already checked to be one by the caller)."""
    if not shutil.which("git"):
        return {"files": [], "lines": [], "lean": "silent", "error": "git isn't installed"}
    with tempfile.TemporaryDirectory(prefix="decompwtf-policy-") as tmp:
        try:
            res = _git("clone", "--depth", "1", "--filter=blob:none", "--no-checkout", "--quiet", url, tmp)
            if res.returncode != 0:
                return {"files": [], "lines": [], "lean": "silent",
                        "error": f"couldn't read the repository: {(res.stderr or res.stdout).strip()[-300:]}"}
            listing = _git("ls-tree", "-r", "--name-only", "HEAD", cwd=tmp).stdout.splitlines()
            files = [f for f in listing if _POLICY_FILE.match(f)][:10]
            found: list[dict] = []
            for f in files:
                shown = _git("show", f"HEAD:{f}", cwd=tmp, timeout=60)
                if shown.returncode == 0:
                    found += [{"file": f, "text": t} for t in lines_about_ai(shown.stdout[:400_000])]
        except subprocess.TimeoutExpired:
            return {"files": [], "lines": [], "lean": "silent", "error": "the repository took too long to answer"}
    found = found[:12]
    return {"files": files, "lines": found, "lean": lean([x["text"] for x in found]), "error": None}
