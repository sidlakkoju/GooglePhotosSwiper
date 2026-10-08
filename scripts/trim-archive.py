#!/usr/bin/env python3
"""Extract one canonical stored movie to a fixed private path, never archive paths."""
import json
import os
import stat
import struct
import sys
import zipfile

LIMIT = 1024 * 1024 * 1024
MAX_ENTRIES = 32
TARGET_CREATED = False

class Rejected(Exception):
    pass

def require(value, message):
    if not value:
        raise Rejected(message)

def directory_bounds(path):
    # Bound central-directory allocation before ZipFile materializes its entries.
    length = os.stat(path).st_size
    require(22 <= length <= LIMIT + 16 * 1024 * 1024, 'Archive byte size is unsupported.')
    with open(path, 'rb') as stream:
        stream.seek(max(0, length - 65557))
        tail = stream.read(65557)
        offset = tail.rfind(b'PK\x05\x06')
        require(offset >= 0 and offset + 22 <= len(tail), 'Archive directory is malformed.')
        sig, disk, directory_disk, disk_count, count, size, start, comment = struct.unpack('<4s4H2IH', tail[offset:offset + 22])
        require(offset + 22 + comment == len(tail), 'Archive has ambiguous trailing data.')
        absolute = length - len(tail) + offset
        end = absolute
        require(disk == 0 and directory_disk == 0 and disk_count == count, 'Multi-volume archives are unsupported.')
        if count == 65535 or size == 0xffffffff or start == 0xffffffff:
            require(absolute >= 20, 'ZIP64 directory is malformed.')
            stream.seek(absolute - 20)
            locator = stream.read(20)
            require(len(locator) == 20, 'ZIP64 locator is malformed.')
            sig, disk, position, disks = struct.unpack('<4sIQI', locator)
            require(sig == b'PK\x06\x07' and disk == 0 and disks == 1 and 0 <= position < absolute - 20, 'ZIP64 locator is unsupported.')
            stream.seek(position)
            record = stream.read(56)
            require(len(record) == 56, 'ZIP64 directory is truncated.')
            sig, record_size, made, needed, disk, directory_disk, disk_count, count, size, start = struct.unpack('<4sQ2H2I4Q', record)
            require(sig == b'PK\x06\x06' and 44 <= record_size <= 1024 and disk == 0 and directory_disk == 0 and disk_count == count, 'ZIP64 directory is unsupported.')
            end = position
        require(1 <= count <= MAX_ENTRIES and 0 < size <= 4 * 1024 * 1024 and 0 <= start and start + size <= end, 'Archive directory exceeds safe bounds.')
        return count

def extract(archive, target, expected_name, expected_size):
    require(expected_name and len(expected_name) <= 512 and '/' not in expected_name and '\\' not in expected_name and '\x00' not in expected_name and expected_name not in ('.', '..'), 'Canonical original filename is unsupported.')
    require(1 <= expected_size <= LIMIT, 'Canonical original byte size is unsupported.')
    count = directory_bounds(archive)
    with zipfile.ZipFile(archive, 'r') as package:
        entries = package.infolist()
        require(len(entries) == count, 'Archive directory entry count changed.')
        names = set()
        files = []
        for entry in entries:
            name = entry.orig_filename
            components = name.rstrip('/').split('/')
            require(name and not name.startswith('/') and '\\' not in name and '\x00' not in name and all(part and part not in ('.', '..') and ':' not in part for part in components), 'Archive contains an unsafe path.')
            require(name.rstrip('/') not in names, 'Archive contains duplicate or ambiguous paths.')
            names.add(name.rstrip('/'))
            mode = stat.S_IFMT(entry.external_attr >> 16)
            require(mode in (0, stat.S_IFREG, stat.S_IFDIR) and (mode != stat.S_IFDIR or entry.is_dir()), 'Archive contains a link or special file.')
            require(not entry.flag_bits & (1 | 64), 'Encrypted archives are unsupported.')
            require(entry.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED), 'Archive compression is unsupported.')
            if entry.is_dir():
                require(entry.file_size == 0, 'Archive directory carries unexpected data.')
            else:
                files.append(entry)
        require(len(files) == 1, 'Archive must contain exactly one original movie.')
        movie = files[0]
        require(movie.orig_filename.split('/')[-1] == expected_name, 'Archive movie filename differs from the exact original.')
        require(movie.file_size == expected_size and 0 <= movie.compress_size <= LIMIT + 16 * 1024 * 1024, 'Archive movie byte size differs from the exact original.')
        count = 0
        global TARGET_CREATED
        descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0), 0o600)
        TARGET_CREATED = True
        with os.fdopen(descriptor, 'wb') as output, package.open(movie, 'r') as source:
            while True:
                chunk = source.read(1024 * 1024)
                if not chunk:
                    break
                count += len(chunk)
                require(count <= expected_size, 'Archive decoded bytes exceed the exact original.')
                output.write(chunk)
            require(count == expected_size, 'Archive decoded byte count is incomplete.')
            output.flush()
            os.fsync(output.fileno())
        return count

if __name__ == '__main__':
    target = None
    try:
        require(len(sys.argv) == 5, 'Invalid archive extraction request.')
        archive, target, name, size = sys.argv[1:]
        count = extract(archive, target, name, int(size))
        print(json.dumps({'ok': True, 'bytes': count}))
    except Exception as error:
        if target and TARGET_CREATED:
            try:
                os.unlink(target)
            except OSError:
                pass
        # Never expose private paths, entry names or subprocess traceback data.
        message = str(error) if isinstance(error, Rejected) else 'Archive integrity or CRC validation failed.'
        print(json.dumps({'ok': False, 'error': message}))
        sys.exit(1)
