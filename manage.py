#!/usr/bin/env python3
"""Mall Management System - one helper for every local task (no Docker needed).

Works on Windows, macOS and Linux with only Python 3.10+, Node.js 18+ and a
MySQL 8 server installed.

    python manage.py setup-db [--no-seed] [-y]   create / re-create mall_db from database/*.sql
    python manage.py start [--host H] [--port P] install what is missing, build the UI, serve on :8000
    python manage.py dev                         API with auto-reload + Vite dev server on :5173
    python manage.py backup [DIR]                full mysqldump -> backups/mall_db_<timestamp>.sql.gz
    python manage.py restore FILE [-y]           restore a .sql / .sql.gz dump and re-apply accounts
    python manage.py test                        run the API test-suite (pytest)

Administrative MySQL connection used by setup-db / backup / restore can be
changed with the environment variables MYSQL_HOST, MYSQL_PORT, MYSQL_USER
(default root), MYSQL_PWD (asked for when not set) and MYSQL_BIN_DIR (folder
containing mysql / mysqldump when they are not on PATH).
"""
from __future__ import annotations

import argparse
import getpass
import gzip
import hashlib
import os
import shutil
import subprocess
import sys
import venv
from datetime import datetime
from pathlib import Path
from typing import NoReturn

ROOT = Path(__file__).resolve().parent
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
DATABASE = ROOT / "database"
VENV = BACKEND / ".venv"
DB_NAME = "mall_db"
WINDOWS = os.name == "nt"


# --------------------------------------------------------------------- helpers
def info(msg: str) -> None:
    print(f"==> {msg}", flush=True)


def die(msg: str) -> NoReturn:
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


def confirm(question: str, assume_yes: bool) -> None:
    if assume_yes:
        return
    if input(f"{question} [y/N] ").strip().lower() not in ("y", "yes"):
        die("cancelled")


def run(cmd: list[str], **kw) -> None:
    result = subprocess.run(cmd, **kw)
    if result.returncode != 0:
        die(f"command failed ({result.returncode}): {' '.join(map(str, cmd))}")


# ------------------------------------------------------------- MySQL client
def mysql_tool(name: str) -> str:
    bin_dir = os.environ.get("MYSQL_BIN_DIR")
    if bin_dir:
        exe = Path(bin_dir) / (name + (".exe" if WINDOWS else ""))
        if exe.exists():
            return str(exe)
        die(f"{exe} not found (check MYSQL_BIN_DIR)")
    found = shutil.which(name)
    if not found and WINDOWS:
        for base in (Path(r"C:\Program Files\MySQL"), Path(r"C:\Program Files (x86)\MySQL")):
            if base.exists():
                for p in sorted(base.glob("*/bin"), reverse=True):
                    candidate = p / f"{name}.exe"
                    if candidate.exists():
                        return str(candidate)
    if not found:
        die(f"'{name}' was not found on PATH. Install the MySQL client or set MYSQL_BIN_DIR "
            "to the folder that contains it (e.g. C:\\Program Files\\MySQL\\MySQL Server 8.4\\bin).")
    return found


def mysql_env() -> dict[str, str]:
    """Environment for mysql/mysqldump; the password travels in MYSQL_PWD, never on argv."""
    env = os.environ.copy()
    if "MYSQL_PWD" not in env:
        user = env.get("MYSQL_USER", "root")
        env["MYSQL_PWD"] = getpass.getpass(f"MySQL password for '{user}' (empty for none): ")
        os.environ["MYSQL_PWD"] = env["MYSQL_PWD"]  # ask only once per run
    return env


def mysql_args(tool: str) -> list[str]:
    return [
        mysql_tool(tool),
        "-h", os.environ.get("MYSQL_HOST", "127.0.0.1"),
        "-P", os.environ.get("MYSQL_PORT", "3306"),
        "-u", os.environ.get("MYSQL_USER", "root"),
        "--default-character-set=utf8mb4",
    ]


def mysql_exec_file(path: Path, env: dict[str, str]) -> None:
    with open(path, "rb") as fh:
        result = subprocess.run(mysql_args("mysql"), stdin=fh, env=env)
    if result.returncode != 0:
        die(f"failed while loading {path.name}")


def mysql_summary(env: dict[str, str]) -> None:
    sql = (
        "SELECT 'tables' AS object, COUNT(*) AS total FROM information_schema.TABLES "
        "  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' "
        "UNION ALL SELECT 'views', COUNT(*) FROM information_schema.VIEWS WHERE TABLE_SCHEMA = DATABASE() "
        "UNION ALL SELECT 'routines', COUNT(*) FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = DATABASE() "
        "UNION ALL SELECT 'triggers', COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() "
        "UNION ALL SELECT 'events', COUNT(*) FROM information_schema.EVENTS WHERE EVENT_SCHEMA = DATABASE() "
        "UNION ALL SELECT 'shops', COUNT(*) FROM shops "
        "UNION ALL SELECT 'invoices', COUNT(*) FROM invoices"
    )
    run(mysql_args("mysql") + ["-t", DB_NAME, "-e", sql], env=env)


# ----------------------------------------------------------- Python / Node
def venv_python() -> Path:
    return VENV / ("Scripts/python.exe" if WINDOWS else "bin/python")


def ensure_backend(dev: bool = False) -> Path:
    """Create backend/.venv and install requirements when they changed."""
    if sys.version_info < (3, 10):
        die("Python 3.10 or newer is required")
    py = venv_python()
    if not py.exists():
        info("creating virtual environment backend/.venv")
        venv.EnvBuilder(with_pip=True).create(VENV)

    req_files = [BACKEND / "requirements.txt"] + ([BACKEND / "requirements-dev.txt"] if dev else [])
    digest = hashlib.sha256(b"".join(f.read_bytes() for f in req_files)).hexdigest()
    stamp = VENV / (".installed-dev" if dev else ".installed")
    if not stamp.exists() or stamp.read_text().strip() != digest:
        info("installing Python packages")
        run([str(py), "-m", "pip", "install", "--disable-pip-version-check", "-q", "--upgrade", "pip"])
        for f in req_files:
            run([str(py), "-m", "pip", "install", "--disable-pip-version-check", "-q", "-r", str(f)])
        stamp.write_text(digest)

    env_file = BACKEND / ".env"
    if not env_file.exists():
        info("creating backend/.env from .env.example (edit it if your MySQL differs)")
        shutil.copyfile(BACKEND / ".env.example", env_file)
    return py


def npm() -> str:
    found = shutil.which("npm")
    if not found:
        die("npm was not found. Install Node.js 18+ from https://nodejs.org")
    return found


def ensure_node_modules() -> None:
    if not (FRONTEND / "node_modules").exists():
        info("installing frontend packages (npm install)")
        run([npm(), "install", "--no-audit", "--no-fund"], cwd=FRONTEND)


def frontend_is_stale() -> bool:
    index = FRONTEND / "dist" / "index.html"
    if not index.exists():
        return True
    built = index.stat().st_mtime
    sources = [FRONTEND / "index.html", FRONTEND / "vite.config.js", FRONTEND / "package.json"]
    sources += [p for d in ("src", "public") for p in (FRONTEND / d).rglob("*") if p.is_file()]
    return any(p.exists() and p.stat().st_mtime > built for p in sources)


def ensure_frontend() -> None:
    if not frontend_is_stale():
        return
    if not shutil.which("npm") and (FRONTEND / "dist" / "index.html").exists():
        print("warning: npm not found - serving the existing frontend/dist build")
        return
    ensure_node_modules()
    info("building the frontend (npm run build)")
    run([npm(), "run", "build"], cwd=FRONTEND)


# ------------------------------------------------------------------ commands
def cmd_setup_db(args: argparse.Namespace) -> None:
    host = os.environ.get("MYSQL_HOST", "127.0.0.1")
    confirm(f"This will DROP and re-create '{DB_NAME}' on {host}. Continue?", args.yes)
    env = mysql_env()
    for path in sorted(DATABASE.glob("0*.sql")):
        if args.no_seed and "seed" in path.name:
            print(f"  skip  {path.name}")
            continue
        print(f"  load  {path.name} ... ", end="", flush=True)
        mysql_exec_file(path, env)
        print("ok")
    print()
    mysql_summary(env)
    print(f"Database '{DB_NAME}' is ready.")


def cmd_start(args: argparse.Namespace) -> None:
    py = ensure_backend()
    ensure_frontend()
    shown = "localhost" if args.host in ("0.0.0.0", "127.0.0.1") else args.host
    info(f"starting the app on http://{shown}:{args.port}  (Ctrl+C to stop)")
    try:
        subprocess.run([str(py), "-m", "uvicorn", "app.main:app",
                        "--host", args.host, "--port", str(args.port)], cwd=BACKEND)
    except KeyboardInterrupt:
        pass


def cmd_dev(args: argparse.Namespace) -> None:
    py = ensure_backend()
    ensure_node_modules()
    info("API on http://localhost:8000, UI with hot reload on http://localhost:5173 (Ctrl+C to stop)")
    api = subprocess.Popen([str(py), "-m", "uvicorn", "app.main:app", "--reload",
                            "--host", "127.0.0.1", "--port", "8000"], cwd=BACKEND)
    ui = subprocess.Popen([npm(), "run", "dev"], cwd=FRONTEND)
    try:
        api.wait()
        ui.wait()
    except KeyboardInterrupt:
        pass
    finally:
        for proc in (ui, api):
            if proc.poll() is None:
                proc.terminate()


def cmd_backup(args: argparse.Namespace) -> None:
    out_dir = Path(args.dir) if args.dir else ROOT / "backups"
    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / f"{DB_NAME}_{datetime.now():%Y%m%d_%H%M%S}.sql.gz"
    env = mysql_env()
    # --single-transaction : consistent InnoDB snapshot without locking tables
    # --routines/--triggers/--events : include the programmable objects
    # --no-tablespaces : does not need the PROCESS privilege
    cmd = mysql_args("mysqldump") + ["--single-transaction", "--routines", "--triggers", "--events",
                                     "--no-tablespaces", "--set-gtid-purged=OFF",
                                     "--databases", DB_NAME]
    with subprocess.Popen(cmd, stdout=subprocess.PIPE, env=env) as proc, gzip.open(target, "wb") as gz:
        shutil.copyfileobj(proc.stdout, gz)
    if proc.returncode != 0:
        target.unlink(missing_ok=True)
        die("mysqldump failed")
    print(f"Backup written to {target} ({target.stat().st_size / 1024:.0f} KB)")
    print("Accounts and roles are not in the dump; 'restore' re-applies database/06_security.sql.")


def cmd_restore(args: argparse.Namespace) -> None:
    source = Path(args.file)
    if not source.is_file():
        die(f"file not found: {source}")
    confirm(f"This will REPLACE '{DB_NAME}' with {source.name}. Continue?", args.yes)
    env = mysql_env()
    info("restoring")
    opener = gzip.open if source.suffix == ".gz" else open
    with opener(source, "rb") as fh, subprocess.Popen(mysql_args("mysql"), stdin=subprocess.PIPE, env=env) as proc:
        shutil.copyfileobj(fh, proc.stdin)
        proc.stdin.close()
    if proc.returncode != 0:
        die("restore failed")
    info("re-applying accounts and privileges")
    mysql_exec_file(DATABASE / "06_security.sql", env)
    mysql_summary(env)
    print("Restore complete.")


def cmd_test(args: argparse.Namespace) -> None:
    py = ensure_backend(dev=True)
    result = subprocess.run([str(py), "-m", "pytest", *args.pytest_args], cwd=BACKEND)
    print("\nNote: the tests add records of their own - run 'python manage.py setup-db' to reset the sample data.")
    sys.exit(result.returncode)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("setup-db", help="create / re-create the database from database/*.sql")
    p.add_argument("--no-seed", action="store_true", help="skip the sample data (05_seed.sql)")
    p.add_argument("-y", "--yes", action="store_true", help="do not ask for confirmation")
    p.set_defaults(func=cmd_setup_db)

    p = sub.add_parser("start", help="install what is missing, build the UI and serve the app")
    p.add_argument("--host", default="127.0.0.1", help="use 0.0.0.0 to allow other devices on the network")
    p.add_argument("--port", type=int, default=8000)
    p.set_defaults(func=cmd_start)

    p = sub.add_parser("dev", help="API with auto-reload + Vite dev server")
    p.set_defaults(func=cmd_dev)

    p = sub.add_parser("backup", help="full mysqldump backup (gzip)")
    p.add_argument("dir", nargs="?", help="output folder (default: backups/)")
    p.set_defaults(func=cmd_backup)

    p = sub.add_parser("restore", help="restore a backup and re-apply accounts")
    p.add_argument("file", help=".sql or .sql.gz file")
    p.add_argument("-y", "--yes", action="store_true", help="do not ask for confirmation")
    p.set_defaults(func=cmd_restore)

    p = sub.add_parser("test", help="run the API tests (extra arguments go to pytest)")
    p.set_defaults(func=cmd_test)

    sys.stdout.reconfigure(line_buffering=True)  # keep our output in order with the child processes
    args, extra = parser.parse_known_args()
    if args.command == "test":
        args.pytest_args = extra  # e.g. python manage.py test -q -k invoices
    elif extra:
        parser.error(f"unrecognized arguments: {' '.join(extra)}")
    args.func(args)


if __name__ == "__main__":
    main()
