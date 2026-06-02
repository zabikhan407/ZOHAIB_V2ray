const net = require('net');
const axios = require('axios');

module.exports = async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'Missing url' });
    try {
        const latency = await tcpPing(url);
        const country = await getCountry(url);
        res.json({ latency, country });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

function tcpPing(link) {
    return new Promise((resolve) => {
        const hostMatch = link.match(/@([^:]+):(\d+)/);
        if (!hostMatch) return resolve(null);
        const host = hostMatch[1];
        const port = parseInt(hostMatch[2], 10);
        const start = Date.now();
        const socket = new net.Socket();
        socket.setTimeout(3000);
        socket.connect(port, host, () => {
            const latency = Date.now() - start;
            socket.destroy();
            resolve(latency);
        });
        socket.on('timeout', () => resolve(null));
        socket.on('error', () => resolve(null));
    });
}

async function getCountry(link) {
    const match = link.match(/@([^:]+):/);
    if (!match) return 'Unknown';
    const domain = match[1];
    try {
        const geo = await axios.get(`http://ip-api.com/json/${domain}`, { timeout: 2000 });
        if (geo.data && geo.data.country) return geo.data.country;
    } catch (e) {}
    return 'Unknown';
    }
