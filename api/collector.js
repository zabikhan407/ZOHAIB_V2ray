const axios = require('axios');
const net = require('net');

module.exports = async (req, res) => {
    try {
        const url = 'https://raw.githubusercontent.com/4n0nymou3/multi-proxy-config-fetcher/main/configs/proxy_configs.txt';
        const response = await axios.get(url, { timeout: 10000 });
        const lines = response.data.split('\n');
        
        let configs = [];
        for (let line of lines) {
            line = line.trim();
            if ((line.startsWith('vless://') || line.startsWith('trojan://')) && line.includes('type=ws')) {
                configs.push(line);
            }
        }
        configs = [...new Map(configs.map(c => [c, c])).values()];
        const toTest = configs.slice(0, 30);
        const results = [];
        for (const cfg of toTest) {
            const ping = await tcpPing(cfg);
            if (ping !== null) {
                const country = await getCountryFromConfig(cfg);
                results.push({ config: cfg, ping, country });
            }
        }
        results.sort((a,b) => a.ping - b.ping);
        res.status(200).json({ status: 'success', total: results.length, configs: results });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
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
        socket.on('timeout', () => { socket.destroy(); resolve(null); });
        socket.on('error', () => resolve(null));
    });
}

async function getCountryFromConfig(link) {
    const match = link.match(/@([^:]+):/);
    if (!match) return 'Unknown';
    const domain = match[1];
    try {
        const geoRes = await axios.get(`http://ip-api.com/json/${domain}`, { timeout: 2000 });
        if (geoRes.data && geoRes.data.country) return geoRes.data.country;
    } catch (e) {}
    const lower = domain.toLowerCase();
    if (lower.includes('sg')) return 'Singapore';
    if (lower.includes('pk')) return 'Pakistan';
    if (lower.includes('de')) return 'Germany';
    if (lower.includes('us')) return 'United States';
    return 'Unknown';
                   }
