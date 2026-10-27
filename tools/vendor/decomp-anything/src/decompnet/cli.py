"""decompnet command line: run a network, import games, mint agent tokens, export results."""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from .network import Network, NetworkError
from .project import ProjectRejected, import_project


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="decompnet", description="Collaborative matching decompilation for AI agents")
    ap.add_argument("--db", default=os.environ.get("DECOMPNET_DB", "decompnet.db"), help="SQLite database path")
    sub = ap.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("serve", help="run the coordinator (MCP endpoint + API)")
    s.add_argument("--host", default="127.0.0.1")
    s.add_argument("--port", type=int, default=8765)
    s.add_argument("--public-url", help="URL agents use to reach this server (default: derived from host/port)")
    s.add_argument("--open-registration", action="store_true",
                   help="let visitors register agents from the website (also needs TURNSTILE_SECRET and TURNSTILE_HOSTNAMES)")
    s.add_argument("--api-url", help="URL agents and the site use for MCP/API (default: api.<public host>)")

    i = sub.add_parser("import", help="import or refresh a project directory (containing project.toml)")
    i.add_argument("path", type=Path)

    a = sub.add_parser("agent", help="manage agents")
    asub = a.add_subparsers(dest="agent_cmd", required=True)
    add = asub.add_parser("add", help="register an agent and print its token")
    add.add_argument("name")
    add.add_argument("--owner", help="the human operating this agent (used for credit)")
    add.add_argument("--url", default="https://api.decomp.online", help="API URL to print in the join command")

    r = asub.add_parser("revoke", help="disable an agent's token (abuse, repeat infringement)")
    r.add_argument("name")
    r.add_argument("--erase", action="store_true", help="also anonymize the agent and its operator (GDPR erasure)")

    pr = sub.add_parser("project", help="moderate projects")
    prsub = pr.add_subparsers(dest="project_cmd", required=True)
    rm = prsub.add_parser("remove", help="delete a project and everything submitted to it (takedown)")
    rm.add_argument("slug")
    rm.add_argument("--yes", action="store_true", help="confirm deletion")

    fn = sub.add_parser("function", help="moderate functions")
    fnsub = fn.add_subparsers(dest="function_cmd", required=True)
    rs = fnsub.add_parser("reset", help="delete all submissions for one function and reopen it")
    rs.add_argument("project")
    rs.add_argument("name")

    nt = sub.add_parser("note", help="moderate notes")
    ntsub = nt.add_subparsers(dest="note_cmd", required=True)
    nl = ntsub.add_parser("list", help="list a project's notes with their ids")
    nl.add_argument("project")
    nd = ntsub.add_parser("delete", help="delete one note")
    nd.add_argument("id", type=int)

    tc = sub.add_parser("toolchain", help="manage pinned compiler toolchains")
    tcsub = tc.add_subparsers(dest="tc_cmd", required=True)
    tcsub.add_parser("list", help="show the registry and what is installed")
    ti = tcsub.add_parser("install", help="download, verify and install a toolchain")
    ti.add_argument("id")
    ti.add_argument("--accept-license", action="store_true", help="required for proprietary toolchains")
    ti.add_argument("--force", action="store_true", help="reinstall even if present")
    tp = tcsub.add_parser("path", help="print a toolchain's install directory")
    tp.add_argument("id")

    w = sub.add_parser("worker", help="donate compute: permute near-matches on this machine")
    w.add_argument("--server", default="https://api.decomp.online")
    w.add_argument("--token", default=os.environ.get("DECOMPNET_TOKEN"), help="your agent token (or DECOMPNET_TOKEN)")
    w.add_argument("--minutes", type=float, default=10, help="search time per job")
    w.add_argument("--jobs", type=int, default=0, help="stop after this many jobs (0 = run forever)")

    lo = sub.add_parser("local", help="tools for hash-only projects, run against your own lawful copy")
    losub = lo.add_subparsers(dest="local_cmd", required=True)
    la = losub.add_parser("asm", help="disassemble a function from your own object file")
    la.add_argument("object", type=Path)
    la.add_argument("function")
    ld = losub.add_parser("diff", help="compile your C and diff it against your own object file")
    ld.add_argument("object", type=Path)
    ld.add_argument("function")
    ld.add_argument("source", type=Path)
    ld.add_argument("--toolchain", required=True)
    ld.add_argument("--context", type=Path, help="header from get_context, saved to a file")
    ld.add_argument("--include", type=Path, action="append", default=[])

    up = sub.add_parser("upstream", help="commit matched functions to a git repo, one commit per match, with credit")
    up.add_argument("project")
    up.add_argument("repo", type=Path)

    sub.add_parser("status", help="print progress and leaderboard")

    e = sub.add_parser("export", help="write matched sources + context.h for a project")
    e.add_argument("project")
    e.add_argument("out", type=Path)

    args = ap.parse_args(argv)
    __import__("decompnet").utf8_output()
    if args.cmd == "toolchain":
        return toolchain_cmd(args)
    if args.cmd == "worker":
        if not args.token:
            print("error: pass --token or set DECOMPNET_TOKEN (get one at https://decomp.wtf/join)", file=sys.stderr)
            return 1
        from .permuter import worker
        worker(args.server, args.token, args.minutes, args.jobs)
        return 0
    if args.cmd == "local":
        from . import local
        if args.local_cmd == "asm":
            print(local.asm(args.object, args.function))
        else:
            print(local.diff(args.object, args.function, args.source, args.toolchain, args.context, include_dirs=args.include))
        return 0
    net = Network(args.db)
    try:
        if args.cmd == "serve":
            from .server import serve
            serve(net, args.host, args.port, args.public_url, args.open_registration, args.api_url)
        elif args.cmd == "import":
            import_project(net.store, args.path)
        elif args.cmd == "agent" and args.agent_cmd == "add":
            from .server import install_command, join_command
            token = net.register_agent(args.name, args.owner)
            print(f"token: {token}\n\nsend this to the person; it sets everything up and starts their agent:\n"
                  f"  {install_command('https://decomp.wtf', token)}\n\n"
                  f"or, manually in Claude Code:\n  {join_command(args.url.rstrip('/'), token)}")
        elif args.cmd == "agent" and args.agent_cmd == "revoke":
            net.revoke_agent(args.name, erase=args.erase)
            print(f"revoked {args.name}" + (" and erased its identity" if args.erase else ""))
        elif args.cmd == "project":
            if not args.yes:
                print(f"this permanently deletes {args.slug} and all submissions; re-run with --yes", file=sys.stderr)
                return 1
            print(f"removed {args.slug} ({net.remove_project(args.slug)} functions)")
        elif args.cmd == "function":
            net.reset_function(args.project, args.name)
            print(f"reset {args.project}/{args.name}: all submissions deleted")
        elif args.cmd == "note" and args.note_cmd == "list":
            for n in net.list_notes(args.project):
                print(f"[{n['id']}] {n['function'] or 'project'} ({n['agent']}): {n['text']}")
        elif args.cmd == "note" and args.note_cmd == "delete":
            net.delete_note(args.id)
            print(f"deleted note {args.id}")
        elif args.cmd == "status":
            print(net.status())
        elif args.cmd == "upstream":
            from .upstream import export as upstream_export
            upstream_export(net, args.project, args.repo)
        elif args.cmd == "export":
            n = net.export(args.project, args.out)
            print(f"exported {n} matched functions to {args.out}")
    except (NetworkError, ProjectRejected) as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    return 0


def toolchain_cmd(args) -> int:
    from . import toolchains
    try:
        if args.tc_cmd == "list":
            print(f"{'id':16} {'platform':9} {'license':18} {'state':10} name")
            for r in toolchains.status():
                state = "installed" if r["installed"] else "-"
                pin = "" if r["pinned"] else "  (pinned on first install)"
                print(f"{r['id']:16} {r['platform'] or r['kind']:9} {r['license']:18} {state:10} {r['name']}{pin}")
            print(f"\ninstall dir: {toolchains.root()}")
        elif args.tc_cmd == "install":
            toolchains.install(args.id, accept_license=args.accept_license, force=args.force)
        elif args.tc_cmd == "path":
            print(toolchains.require(args.id))
    except toolchains.ToolchainError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
