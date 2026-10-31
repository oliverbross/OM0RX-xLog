#!/usr/bin/env python3
"""Exercise the standard-library modules used by the isolated contest host."""
import argparse
import hashlib
import json
import lzma
import sqlite3
import ssl
import sys

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--expected-version')
parser.add_argument('--openssl-version')
args = parser.parse_args()
assert sys.version_info[:2] == (3, 12), 'The contest runtime requires Python 3.12'
if args.expected_version:
    assert '.'.join(map(str, sys.version_info[:3])) == args.expected_version
if args.openssl_version:
    assert ('OpenSSL ' + args.openssl_version) in ssl.OPENSSL_VERSION
assert hashlib.sha256(b'test').hexdigest() == '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'
assert lzma.decompress(lzma.compress(b'xlog runtime')) == b'xlog runtime'
context = ssl.create_default_context()
assert context.verify_mode == ssl.CERT_REQUIRED and context.check_hostname
assert context.cert_store_stats()['x509_ca'] > 0, 'Trusted certificate authorities are unavailable'
print(json.dumps({'python': sys.version, 'openssl': ssl.OPENSSL_VERSION, 'sqlite': sqlite3.sqlite_version,
                  'certificateAuthorities': context.cert_store_stats()['x509_ca'], 'certificateVerification': True}))
