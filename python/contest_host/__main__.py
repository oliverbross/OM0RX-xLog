"""Bounded serial JSONL protocol. Run: python -m contest_host --data-root PATH."""
import argparse
import json
import logging
import sys

from .host import Host, HostError
from .store import canonical

MAX_REQUEST = 32768
MAX_RESPONSE = 1048576


def run(input_stream, output_stream, host):
    while True:
        raw = input_stream.readline(MAX_REQUEST + 1)
        if not raw:
            return 0
        if len(raw) > MAX_REQUEST or not raw.endswith(b"\n"):
            # Do not attempt to resynchronize a potentially attacker-controlled frame.
            return 2
        request_id = None
        try:
            request = json.loads(raw, parse_constant=lambda value: (_ for _ in ()).throw(ValueError("Nonfinite JSON")))
            if isinstance(request, dict) and isinstance(request.get("id"), str) and len(request["id"]) <= 128:
                request_id = request["id"]
            result = host.dispatch(request)
            response = {"id": request_id, "ok": True, "result": result}
        except HostError as error:
            response = {"id": request_id, "ok": False, "error": {"code": error.code, "message": str(error), "outcome": "rejected"}}
        except (ValueError, UnicodeDecodeError, TypeError) as error:
            response = {"id": request_id, "ok": False, "error": {"code": "invalid_request", "message": "Invalid JSON or field type", "outcome": "rejected"}}
        except Exception:
            logging.exception("Contest host request failed")
            response = {"id": request_id, "ok": False, "error": {"code": "host_failure", "message": "Contest operation failed; reconcile its receipt", "outcome": "uncertain"}}
        encoded = (canonical(response) + "\n").encode("utf-8")
        if len(encoded) > MAX_RESPONSE:
            return 3
        output_stream.write(encoded)
        output_stream.flush()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-root", required=True)
    args = parser.parse_args()
    logging.basicConfig(stream=sys.stderr, level=logging.WARNING)
    host = Host(args.data_root)
    try:
        return run(sys.stdin.buffer, sys.stdout.buffer, host)
    finally:
        host.close()


if __name__ == "__main__":
    raise SystemExit(main())
