import { createHash } from 'node:crypto';

const hash = source => createHash('sha256').update(source).digest('hex');

export function seedChecksums(source) {
  const lf = source.toString('utf8').replace(/\r\n/g, '\n');
  return {
    checksum: hash(lf),
    compatibleChecksums: [...new Set([hash(source), hash(lf), hash(lf.replace(/\n/g, '\r\n'))])],
  };
}

export function matchesSeedChecksum(descriptor, recorded) {
  return typeof recorded === 'string' && [descriptor.checksum, ...(descriptor.compatibleChecksums ?? [])].includes(recorded);
}
