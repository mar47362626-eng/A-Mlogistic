const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { createDatabase } = require('./db');

test('JSON collections persist across restarts and retain order photos', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-logistics-'));
  try {
    const database = createDatabase(directory);
    database.insert('users', {
      id: 'user-1',
      email: 'customer@example.com',
      name: 'Test Customer',
      phone: '555-0100',
      password_salt: 'salt',
      password_hash: 'hash',
      role: 'customer',
      registered_at: 1,
    });
    database.insert('orders', {
      id: 'order-1',
      reference: 'AO-TEST-01',
      user_id: 'user-1',
      photo: Buffer.from([0, 1, 2, 255]),
      photo_type: 'image/png',
      created_at: 2,
    });
    database.insert('notifications', {
      id: 'notification-1',
      subject: 'Test',
      message: 'Test message',
      audience: 'customers',
      audience_label: 'Users',
      recipient_count: 1,
      created_at: 3,
      recipients: ['customer@example.com'],
    });
    database.close();

    const restartedDatabase = createDatabase(directory);
    assert.equal(restartedDatabase.find('users', user => user.id === 'user-1').email, 'customer@example.com');
    assert.deepEqual(restartedDatabase.find('orders', order => order.id === 'order-1').photo, Buffer.from([0, 1, 2, 255]));
    assert.deepEqual(restartedDatabase.find('notifications', notification => notification.id === 'notification-1').recipients, ['customer@example.com']);
    for (const filename of ['users.json', 'riders.json', 'orders.json', 'notifications.json', 'sessions.json']) {
      assert.ok(Array.isArray(JSON.parse(fs.readFileSync(path.join(directory, filename), 'utf8'))));
    }
    restartedDatabase.close();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
