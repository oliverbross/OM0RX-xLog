#!/usr/bin/env python3
"""Runtime-only equivalents of the two native worker NDJSON regressions."""
import json
import os
from pathlib import Path
import selectors
import subprocess
import sys
import time

def validate_responses(responses, recovery=False):
    # The persistent worker correlates independent requests by ID and may finish
    # them out of order. Require exact coverage, not scheduler-dependent order.
    assert len(responses) == 3
    if recovery:
        valid = [item for item in responses if item.get('id') == 'recovered']
        errors = [item for item in responses if item.get('ok') is False]
        assert len(valid) == 1 and valid[0]['ok'] is True
        assert len(errors) == 2 and all(item.get('id') == '' for item in errors)
        assert sorted(item['error']['code'] for item in errors) == ['invalid_request', 'request_too_large']
    else:
        assert sorted(item['id'] for item in responses) == ['one', 'three', 'two']
        assert all(item['ok'] is True for item in responses)
        by_id = {item['id']: item for item in responses}
        assert by_id['two']['result']['record_count'] == 1
        assert by_id['three']['result']['network_contact'] is False


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


def exercise(worker, recovery=False):
    child = subprocess.Popen([worker], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, bufsize=0)
    try:
        if recovery:
            send(child, b'bad JSON\n' + b'x' * 32769 + b'\n' + request('recovered', 'health'))
            responses = [response(child) for _ in range(3)]
        else:
            send(child, request('one', 'health'))
            first = response(child)
            assert first['id'] == 'one' and first['ok'] is True
            second = request('two', 'parse_adif', {'text': '<CALL:5>TEST1<EOR>'})
            send(child, second[:17])
            send(child, second[17:] + request('three', 'self_test'))
            responses = [first, response(child), response(child)]
        validate_responses(responses, recovery)
        child.stdin.close()
        child.wait(timeout=5)
        assert child.returncode == 0
        assert child.stdout.read() == b'' and child.stderr.read() == b''
        return responses
    finally:
        if child.poll() is None:
            child.kill()
        child.wait()


if __name__ == '__main__':
    worker, report = sys.argv[1:]
    self_test = json.loads(subprocess.check_output([worker, '--self-test'], timeout=10))
    assert self_test['ok'] is True and self_test['result']['network_contact'] is False
    local_test = json.loads(subprocess.check_output([worker, '--local-logbook-self-test'], timeout=30))
    assert local_test['ok'] is True and local_test['result']['passed'] is True
    assert local_test['result']['award_programmes'] == 192
    assert local_test['result']['network_contact'] is False and local_test['result']['station_io'] is False
    Path(report).write_text(json.dumps({'schema': 1, 'status': 'passed', 'selfTest': self_test,
                                       'localLogbookTest': local_test,
                                       'openPipeAndFragments': exercise(worker), 'malformedOversizedRecovery': exercise(worker, True),
                                       'framingTestCount': 2}, indent=2) + '\n')
