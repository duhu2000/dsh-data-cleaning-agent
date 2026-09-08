export function memoryStorageDomain() {
  const domains = new Map();
  return {
    async open(spec) {
      let tables = domains.get(spec.name);
      if (!tables) {
        tables = new Map(Object.keys(spec.tables).map((name) => [name, new Map()]));
        domains.set(spec.name, tables);
      }
      return {
        table(name) {
          const data = tables.get(name);
          return {
            get: (key) => data.get(key),
            entries: () => data.entries(),
            put: async (key, value) => data.set(key, structuredClone(value)),
            update: async (key, updater) => data.set(key, structuredClone(updater(data.get(key)))),
          };
        },
        async close() {},
      };
    },
  };
}

export function memoryFs() {
  const files = new Map();
  return {
    files,
    sandboxMode: 'workspace-write',
    async resolve(path) { return { key: path, displayPath: `/workspace/${path}` }; },
    async writeText(target, content) { files.set(target.key, Buffer.from(content, 'utf8')); },
    async readBytes(target, _signal, maxBytes) {
      const bytes = files.get(target.key);
      if (!bytes) throw Object.assign(new Error('missing'), { code: 'FS_NOT_FOUND' });
      if (bytes.length > maxBytes) throw Object.assign(new Error('too large'), { code: 'FS_TOO_LARGE' });
      return bytes;
    },
  };
}

