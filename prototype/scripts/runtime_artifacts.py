"""Pinned upstream runtime inputs; extraction never trusts archive paths."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
SOURCE_FILE = Path(__file__).with_name('runtime-sources.json')


def sources():
    value = json.loads(SOURCE_FILE.read_text())
    if value.get('schema') != 1:
        raise ValueError('Unsupported runtime source manifest')
    return value


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def download(name, cache=None):
    entry = sources()[name]
    cache = cache or ROOT / '.build/runtime-downloads'
    cache.mkdir(parents=True, exist_ok=True)
    suffix = entry.get('suffix', '.tar.xz' if entry['url'].endswith('.xz') else '.tar.gz')
    target = cache / (entry['sha256'] + suffix)
    if not target.exists():
        partial = target.with_suffix(target.suffix + '.partial')
        if partial.exists():
            raise ValueError(f'Interrupted runtime download retained: {partial}')
        with urllib.request.urlopen(entry['url'], timeout=60) as response, partial.open('xb') as output:
            total = 0
            while block := response.read(1024 * 1024):
                total += len(block)
                if total > 128 * 1024 * 1024:
                    raise ValueError('Runtime source archive exceeds download bound')
                output.write(block)
        if digest(partial) != entry['sha256'] or ('bytes' in entry and partial.stat().st_size != entry['bytes']):
            raise ValueError(f'Runtime archive failed pinned verification; retained {partial}')
        partial.rename(target)
    if digest(target) != entry['sha256'] or ('bytes' in entry and target.stat().st_size != entry['bytes']):
        raise ValueError('Cached runtime archive differs from its pinned source')
    return target


def extract(archive, destination, prefix):
    destination = destination.resolve()
    if destination.exists() and any(destination.iterdir()):
        raise ValueError('Runtime extraction destination must be new or empty')
    destination.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive) as source:
        members = source.getmembers()
        if len(members) > 100_000 or sum(member.size for member in members) > 1024 * 1024 * 1024:
            raise ValueError('Runtime archive exceeds extraction bound')
        for member in members:
            path = PurePosixPath(member.name)
            if path.is_absolute() or '..' in path.parts or not path.parts or path.parts[0] != prefix or '\\' in member.name or any(':' in part for part in path.parts):
                raise ValueError('Runtime archive has an unsafe path or unexpected prefix')
            if not (member.isfile() or member.isdir() or member.issym() or member.islnk()):
                raise ValueError('Runtime archive contains an unsupported special file')
            if member.issym() or member.islnk():
                link = PurePosixPath(member.linkname)
                if link.is_absolute() or '\\' in member.linkname or any(':' in part for part in link.parts):
                    raise ValueError('Runtime archive has an absolute link')
                relative = (path.parent / link) if member.issym() else link
                depth = 0
                for part in relative.parts:
                    depth += -1 if part == '..' else 0 if part == '.' else 1
                    if depth < 1:
                        raise ValueError('Runtime archive link escapes its source prefix')
        source.extractall(destination, members=members, filter='data')
    for path in destination.rglob('*'):
        if path.is_symlink() and not path.resolve(strict=True).is_relative_to(destination):
            raise ValueError('Extracted runtime link escapes its destination')
    return destination / prefix
