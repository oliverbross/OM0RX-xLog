#!/usr/bin/env python3
"""Runtime-only equivalents of the two native worker NDJSON regressions."""
import json
import os
from pathlib import Path
import selectors
import subprocess
import sys
import time

worker, report = sys.argv[1:]


def request(identifier, method, params=None):
    return json.dumps({'id': identifier, 'method': method, 'params': params or {}}).encode() + b'\n'


def send(child, data):
    deadline = time.monotonic() + 5
    os.set_blocking(child.stdin.fileno(), False)
    with selectors.DefaultSelector() as selector:
        selector.register(child.stdin, selectors.EVENT_WRITE)
        while data:
            remaining = deadline - time.monotonic()
            assert remaining > 0 and selector.select(remaining), 'Worker input timed out'
            count = os.write(child.stdin.fileno(), data)
            data = data[count:]


def response(child):
    # Unbuffered bytewise bounded read proves response arrives before closing stdin.
    line = bytearray()
    deadline = time.monotonic() + 5
    with selectors.DefaultSelector() as selector:
        selector.register(child.stdout, selectors.EVENT_READ)
        while len(line) <= 65536:
            remaining = deadline - time.monotonic()
            assert remaining > 0 and selector.select(remaining), 'Open-pipe response timed out'
            byte = os.read(child.stdout.fileno(), 1)
            assert byte, 'Incomplete NDJSON response'
            line.extend(byte)
            if byte == b'\n':
                assert len(line) <= 65536
                return json.loads(line)
    raise AssertionError('Response exceeded 65536 bytes')


def exercise(recovery=False):
    child = subprocess.Popen([worker], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, bufsize=0)
    try:
        if recovery:
            send(child, b'bad JSON\n' + b'x' * 32769 + b'\n' + request('recovered', 'health'))
            responses = [response(child) for _ in range(3)]
            assert [item['error']['code'] for item in responses[:2]] == ['invalid_request', 'request_too_large']
            assert responses[2]['id'] == 'recovered' and responses[2]['ok'] is True
        else:
            send(child, request('one', 'health'))
            first = response(child)
            second = request('two', 'parse_adif', {'text': '<CALL:5>TEST1<EOR>'})
            send(child, second[:17])
            send(child, second[17:] + request('three', 'self_test'))
            responses = [first, response(child), response(child)]
            assert [item['id'] for item in responses] == ['one', 'two', 'three']
            assert all(item['ok'] is True for item in responses)
            assert responses[1]['result']['record_count'] == 1
            assert responses[2]['result']['network_contact'] is False
        child.stdin.close()
        child.wait(timeout=5)
        assert child.returncode == 0
        assert child.stdout.read() == b'' and child.stderr.read() == b''
        return responses
    finally:
        if child.poll() is None:
            child.kill()
        child.wait()


self_test = json.loads(subprocess.check_output([worker, '--self-test'], timeout=10))
assert self_test['ok'] is True and self_test['result']['network_contact'] is False
Path(report).write_text(json.dumps({'schema': 1, 'status': 'passed', 'selfTest': self_test,
                                   'openPipeAndFragments': exercise(), 'malformedOversizedRecovery': exercise(True),
                                   'framingTestCount': 2}, indent=2) + '\n')
