const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const collections = ['users', 'riders', 'orders', 'notifications', 'sessions'];

function uniqueError() {
  const error = new Error('A record with a unique field already exists.');
  error.code = 'JSON_CONSTRAINT_UNIQUE';
  return error;
}

function importLegacyDatabase(filename) {
  if (!fs.existsSync(filename)) return null;
  const legacy = new DatabaseSync(filename, { readOnly: true });
  try {
    const state = Object.fromEntries(collections.map(name => [name, []]));
    for (const name of ['users', 'riders', 'orders', 'notifications', 'sessions']) {
      state[name] = legacy.prepare(`SELECT * FROM ${name}`).all().map(row => {
        if (name === 'orders') row.photo = Buffer.from(row.photo).toString('base64');
        return row;
      });
    }
    const recipients = legacy.prepare('SELECT notification_id, email FROM notification_recipients').all();
    for (const notification of state.notifications) {
      notification.recipients = recipients
        .filter(recipient => recipient.notification_id === notification.id)
        .map(recipient => recipient.email);
    }
    return state;
  } finally {
    legacy.close();
  }
}

function createDatabase(directory = path.join(__dirname, 'data')) {
  const inMemory = directory === ':memory:';
  const dataDirectory = inMemory ? null : directory;
  if (dataDirectory) fs.mkdirSync(dataDirectory, { recursive: true });

  let state;
  if (inMemory) {
    state = Object.fromEntries(collections.map(name => [name, []]));
  } else {
    const legacyPath = path.join(dataDirectory, 'ao-logistics.sqlite');
    const migrationMarker = path.join(dataDirectory, '.json-migration-complete');
    state = fs.existsSync(migrationMarker) ? null : importLegacyDatabase(legacyPath);
    if (state) {
      for (const name of collections) {
        const filename = path.join(dataDirectory, `${name}.json`);
        const temporary = `${filename}.${process.pid}.migration.tmp`;
        fs.writeFileSync(temporary, `${JSON.stringify(state[name], null, 2)}\n`, { flag: 'w', mode: 0o600 });
        fs.renameSync(temporary, filename);
      }
      fs.writeFileSync(migrationMarker, 'complete\n', { flag: 'wx', mode: 0o600 });
    }
    if (!state) state = Object.fromEntries(collections.map(name => [name, []]));
    for (const name of collections) {
      const filename = path.join(dataDirectory, `${name}.json`);
      if (!fs.existsSync(filename)) {
        fs.writeFileSync(filename, '[]\n', { flag: 'wx', mode: 0o600 });
      } else {
        const parsed = JSON.parse(fs.readFileSync(filename, 'utf8'));
        if (!Array.isArray(parsed)) throw new Error(`${name}.json must contain a JSON array.`);
        state[name] = parsed;
      }
    }
  }

  function persist(name) {
    if (!dataDirectory) return;
    const filename = path.join(dataDirectory, `${name}.json`);
    const temporary = `${filename}.${process.pid}.${Date.now()}.tmp`;
    try {
      fs.writeFileSync(temporary, `${JSON.stringify(state[name], null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      fs.renameSync(temporary, filename);
    } catch (error) {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
      throw error;
    }
  }

  function storedRecord(name, record) {
    const copy = { ...record };
    if (name === 'orders' && Buffer.isBuffer(copy.photo)) copy.photo = copy.photo.toString('base64');
    return copy;
  }

  function returnedRecord(name, record) {
    if (!record) return record;
    const copy = { ...record };
    if (name === 'orders' && typeof copy.photo === 'string') copy.photo = Buffer.from(copy.photo, 'base64');
    return copy;
  }

  return {
    find(name, predicate) {
      const record = state[name].find(predicate);
      return returnedRecord(name, record);
    },
    list(name, predicate = () => true) {
      return state[name].filter(predicate).map(record => returnedRecord(name, record));
    },
    insert(name, record) {
      const normalized = storedRecord(name, record);
      const email = normalized.email?.toLowerCase();
      if (name === 'users' || name === 'riders') {
        if (state[name].some(existing => existing.email.toLowerCase() === email)) throw uniqueError();
      }
      if ((normalized.id && state[name].some(existing => existing.id === normalized.id))
        || (name === 'sessions' && state[name].some(existing => existing.token_hash === normalized.token_hash))
        || (name === 'orders' && state[name].some(existing => existing.reference === normalized.reference))
        || (name === 'riders' && state[name].some(existing => existing.reference === normalized.reference))) {
        throw uniqueError();
      }
      state[name].push(normalized);
      try {
        persist(name);
      } catch (error) {
        state[name].pop();
        throw error;
      }
      return returnedRecord(name, normalized);
    },
    update(name, predicate, updateRecord) {
      const index = state[name].findIndex(predicate);
      if (index === -1) return null;
      const previous = state[name][index];
      state[name][index] = storedRecord(name, updateRecord(returnedRecord(name, previous)));
      try {
        persist(name);
      } catch (error) {
        state[name][index] = previous;
        throw error;
      }
      return returnedRecord(name, state[name][index]);
    },
    remove(name, predicate) {
      const removed = [];
      const previousState = state[name];
      const retained = [];
      for (const record of state[name]) {
        if (predicate(record)) removed.push(record);
        else retained.push(record);
      }
      if (!removed.length) return 0;
      state[name] = retained;
      try {
        persist(name);
      } catch (error) {
        state[name] = previousState;
        throw error;
      }
      return removed.length;
    },
    close() {},
  };
}

module.exports = { createDatabase };
