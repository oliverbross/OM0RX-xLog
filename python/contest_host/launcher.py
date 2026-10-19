"""Application-relative entry point for an isolated bundled CPython process.

Invoke with interpreter -I -B /absolute/path/contest_host/launcher.py.
"""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from contest_host.__main__ import main

if __name__ == "__main__":
    raise SystemExit(main())
