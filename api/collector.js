const axios = require('axios');
const net = require('net');

const SOURCES = [
    'https://raw.githubusercontent.com/4n0nymou3/multi-proxy-config-fetcher/main/configs/proxy_configs.txt',
    'https://raw.githubusercontent.com/MhdiTaheri/V2rayCollector/main/configs.txt',
    'https://raw.githubusercontent.com/V2RayRoot/V2RayConfig/main/Config/vless.txt',
    'https://raw.githubusercontent.com/facksten/V2rayScrapper/main/configs_to_test.txt',
    'https://raw.githubusercontent.com/hamidhajilou/V2ray-Collector/main/Subs.txt',
    'https://raw.githubusercontent.com/mikeesierrah/Configs4V2ray/main/all.txt'
];

module.exports = async (req, res) => {
    try {
        let allLinks = new Set();
        for (const src of SOURCES) {
            try {
                const resp = await axios.get(src, { timeout: 10000 });
                const lines = resp.data.split('\n');
                for (let line of lines) {
                    line = line.trim();
                    if ((line.startsWith('vless://') || line.startsWith('trojan://')) && line.includes('type=ws')) {
                        allLinks.add(line);
                    }
                }
            } catch (e) { /* skip dead source */ }
        }

        let configs = [...allLinks];
        // Shuffle to get variety, then limit to 200 (performance)
        configs = configs.sort(() => 0.5 - Math.random()).slice(0, 200);
        
        const results = [];
        // Test in batches of 10 to avoid timeout
        for (let i = 0; i < configs.length; i += 10) {
            const batch = configs.slice(i, i+10);
            const batchResults = await Promise.all(batch.map(cfg => deepTest(cfg)));
            results.push(...batchResults.filter(r => r !== null));
        }
        
        // Sort by ping ascending (fastest first)
        results.sort((a,b) => (a.ping || 9999) - (b.ping || 9999));
        res.status(200).json({ status: 'success', total: results.length, configs: results });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
};

async function deepTest(link) {
    const tcpPingResult = await tcpPing(link);
    if (!tcpPingResult || tcpPingResult > 3000) return null; // TCP fail or slow
    
    // Now verify WebSocket endpoint actually responds
    const wsOk = await checkWebSocketEndpoint(link);
    if (!wsOk) return null;
    
    const country = await getCountry(link);
    return {
        config: link,
        ping: tcpPingResult,
        alive: true,
        country: country
    };
}

function tcpPing(link) {
    return new Promise((resolve) => {
        const match = link.match(/@([^:]+):(\d+)/);
        if (!match) return resolve(null);
        const host = match[1];
        const port = parseInt(match[2], 10);
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

async function checkWebSocketEndpoint(link) {
    // Extract parameters from vless/trojan link
    let host, port, path, sni, isTls = false;
    const url = new URL(link);
    if (link.startsWith('vless://')) {
        host = url.hostname;
        port = url.port || (url.searchParams.get('security') === 'tls' ? 443 : 80);
        path = url.searchParams.get('path') || '/';
        sni = url.searchParams.get('sni') || host;
        isTls = url.searchParams.get('security') === 'tls' || url.searchParams.get('encryption') === 'tls';
    } else if (link.startsWith('trojan://')) {
        const atIndex = link.indexOf('@');
        const afterAt = link.substring(atIndex+1);
        const firstColon = afterAt.indexOf(':');
        host = afterAt.substring(0, firstColon);
        const rest = afterAt.substring(firstColon+1);
        const slashIndex = rest.indexOf('/');
        port = rest.substring(0, slashIndex);
        const queryIndex = rest.indexOf('?');
        if (queryIndex !== -1) {
            const query = rest.substring(queryIndex);
            const params = new URLSearchParams(query);
            path = params.get('path') || '/';
            sni = params.get('sni') || host;
            isTls = params.get('security') === 'tls' || params.get('type') === 'ws';
        } else {
            path = '/';
            sni = host;
        }
    } else return false;
    
    if (!host || !port) return false;
    const protocol = isTls ? 'https' : 'http';
    const endpoint = `${protocol}://${host}:${port}${path}`;
    try {
        const res = await axios.get(endpoint, {
            headers: { 'Host': sni || host },
            timeout: 2000,
            validateStatus: (status) => status < 500 // accept 200, 400, 401, 404 etc.
        });
        // If we get any response (even 400), the WebSocket endpoint exists
        return true;
    } catch (err) {
        // If error is not a timeout, maybe endpoint exists but returns 403 etc.
        if (err.response && err.response.status < 500) return true;
        return false;
    }
}

async function getCountry(link) {
    const match = link.match(/@([^:]+):/);
    if (!match) return 'Unknown';
    const domain = match[1];
    try {
        const geo = await axios.get(`http://ip-api.com/json/${domain}`, { timeout: 2000 });
        if (geo.data && geo.data.country) return geo.data.country;
    } catch (e) {}
    // Fallback guess
    const lower = domain.toLowerCase();
    if (lower.includes('sg')) return 'Singapore';
    if (lower.includes('pk')) return 'Pakistan';
    if (lower.includes('de')) return 'Germany';
    if (lower.includes('us')) return 'United States';
    if (lower.includes('ca')) return 'Canada';
    if (lower.includes('jp')) return 'Japan';
    if (lower.includes('in')) return 'India';
    if (lower.includes('fr')) return 'France';
    if (lower.includes('nl')) return 'Netherlands';
    if (lower.includes('gb') || lower.includes('uk')) return 'United Kingdom';
    return 'Unknown';
            }
