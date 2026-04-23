const net = require('net');

const client = new net.Socket();
const host = 'cluster0-shard-00-00.mso6p.mongodb.net';
const port = 27017;

console.log(`Connecting to ${host}:${port}...`);

client.connect(port, host, function() {
    console.log('Connected!');
    client.destroy();
});

client.on('error', function(err) {
    console.error('Connection failed:', err.message);
});

client.on('timeout', function() {
    console.log('Connection timed out');
    client.destroy();
});

client.setTimeout(5000);
