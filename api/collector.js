const axios = require('axios');
const net = require('net');

// Multiple public sources for maximum configs
const SOURCES = [
    'https://raw.githubusercontent.com/4n0nymou3/multi-proxy-config-fetcher/main/configs/proxy_configs.txt',
    'https://raw.githubusercontent.com/MhdiTaheri/V2rayCollector/main/configs.txt',
    'https://raw.githubusercontent.com/V2RayRoot/V2RayConfig/main/Config/vless.txt',
    'https://raw.githubusercontent.com/facksten/V2rayScrapper/main/configs_to_test.txt'
];

module.exports = async (req, res) => {
    try {
        let allLines = new Set();
        for (const src of SOURCES) {
            try {
                const response = await axios.get(src, { timeout: 8000 });
                const lines = response.data.split('\n');
                for (let line of lines) {
                    line = line.trim();
                    if ((line.startsWith('vless://') || line.startsWith('trojan://')) && line.includes('type=ws')) {
                        allLines.add(line);
                    }
                }
            } catch (e) { /* ignore failed source */ }
        }
        let configs = [...allLines];
        // Limit to first 120 for performance (Vercel timeout 10s)
        const toTest = configs.slice(0, 120);
        const results = [];
        
        // Test in parallel with concurrency limit to avoid flooding
        const concurrency = 10;
        for (let i = 0; i < toTest.length; i += concurrency) {
            const batch = toTest.slice(i, i + concurrency);
            const batchResults = await Promise.all(batch.map(cfg => testSingleConfig(cfg)));
            results.push(...batchResults.filter(r => r !== null));
        }
        
        results.sort((a,b) => (a.alive === b.alive) ? (a.ping - b.ping) : (b.alive - a.alive));
        res.status(200).json({ status: 'success', total: results.length, configs: results });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
};

async function testSingleConfig(cfg) {
    const ping = await tcpPing(cfg);
    const alive = (ping !== null && ping < 5000);
    let country = 'Unknown';
    if (alive) country = await getCountryFromConfig(cfg);
    else {
        // still try to guess from domain
        country = guessCountryFromDomain(cfg);
    }
    return { config: cfg, ping: alive ? ping : null, alive, country };
}

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
    return guessCountryFromDomain(link);
}

function guessCountryFromDomain(link) {
    const match = link.match(/@([^:]+):/);
    if (!match) return 'Unknown';
    const host = match[1].toLowerCase();
    if (host.includes('sg')) return 'Singapore';
    if (host.includes('pk')) return 'Pakistan';
    if (host.includes('de')) return 'Germany';
    if (host.includes('us') || host.includes('usa')) return 'United States';
    if (host.includes('ca')) return 'Canada';
    if (host.includes('nl')) return 'Netherlands';
    if (host.includes('fr')) return 'France';
    if (host.includes('jp')) return 'Japan';
    if (host.includes('in')) return 'India';
    return 'Unknown';
        }
