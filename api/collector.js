const axios = require('axios');
const net = require('net');

// Multiple sources (10+)
const SOURCES = [
    'https://raw.githubusercontent.com/4n0nymou3/multi-proxy-config-fetcher/main/configs/proxy_configs.txt',
    'https://raw.githubusercontent.com/MhdiTaheri/V2rayCollector/main/configs.txt',
    'https://raw.githubusercontent.com/V2RayRoot/V2RayConfig/main/Config/vless.txt',
    'https://raw.githubusercontent.com/facksten/V2rayScrapper/main/configs_to_test.txt',
    'https://raw.githubusercontent.com/soroushmirzaei/Telegram-configs-collector/main/configs/v2ray',
    'https://raw.githubusercontent.com/hamidhajilou/V2ray-Collector/main/Subs.txt',
    'https://raw.githubusercontent.com/mikeesierrah/Configs4V2ray/main/all.txt',
    'https://raw.githubusercontent.com/Barrel-/V2Ray-Configs/main/configs.txt',
    'https://raw.githubusercontent.com/AzadNetCH/V2Ray-Configs/main/All_Configs.txt',
    'https://raw.githubusercontent.com/Ptechgithub/Configs/main/AllConfigs.txt'
];

let cachedResult = null;
let lastFetchTime = 0;
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

module.exports = async (req, res) => {
    try {
        // Check cache
        const now = Date.now();
        if (cachedResult && (now - lastFetchTime) < CACHE_TTL) {
            return res.status(200).json(cachedResult);
        }

        // Fetch fresh configs
        let allLinks = new Set();
        for (const src of SOURCES) {
            try {
                const resp = await axios.get(src, { timeout: 8000 });
                const lines = resp.data.split('\n');
                for (let line of lines) {
                    line = line.trim();
                    if ((line.startsWith('vless://') || line.startsWith('trojan://')) && line.includes('type=ws')) {
                        allLinks.add(line);
                    }
                }
            } catch (e) { /* ignore failed source */ }
        }

        let configs = [...allLinks];
        // Limit to 80 for performance
        configs = configs.slice(0, 80);
        
        const results = [];
        // Test in parallel batches
        const batchSize = 5;
        for (let i = 0; i < configs.length; i += batchSize) {
            const batch = configs.slice(i, i+batchSize);
            const batchResults = await Promise.all(batch.map(cfg => thoroughTest(cfg)));
            results.push(...batchResults.filter(r => r !== null && r.alive === true));
        }

        // Sort by ping
        results.sort((a,b) => a.ping - b.ping);
        
        const response = { status: 'success', total: results.length, configs: results };
        cachedResult = response;
        lastFetchTime = now;
        
        res.status(200).json(response);
    } catch (err) {
        // Return cache if exists, else empty
        if (cachedResult) {
            res.status(200).json(cachedResult);
        } else {
            res.status(200).json({ status: 'success', total: 0, configs: [] });
        }
    }
};

async function thoroughTest(link) {
    // 1. TCP ping
    const tcpLatency = await tcpPing(link);
    if (!tcpLatency || tcpLatency > 4000) return null;
    
    // 2. WebSocket endpoint check (HTTP GET to path)
    const wsReachable = await checkWebSocketPath(link);
    if (!wsReachable) return null;
    
    // 3. Country detection (smart)
    const country = await getAccurateCountry(link);
    
    return {
        config: link,
        ping: tcpLatency,
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

async function checkWebSocketPath(link) {
    // Extract path and host
    let host, port, path, sni, isTls = false;
    if (link.startsWith('vless://')) {
        const url = new URL(link);
        host = url.hostname;
        port = url.port || (url.searchParams.get('security') === 'tls' ? 443 : 80);
        path = url.searchParams.get('path') || '/';
        sni = url.searchParams.get('sni') || host;
        isTls = url.searchParams.get('security') === 'tls';
    } else if (link.startsWith('trojan://')) {
        const afterAt = link.split('@')[1];
        const firstColon = afterAt.indexOf(':');
        host = afterAt.substring(0, firstColon);
        const rest = afterAt.substring(firstColon+1);
        const slashIndex = rest.indexOf('/');
        port = rest.substring(0, slashIndex);
        const queryStart = rest.indexOf('?');
        if (queryStart !== -1) {
            const query = rest.substring(queryStart);
            const params = new URLSearchParams(query);
            path = params.get('path') || '/';
            sni = params.get('sni') || host;
            isTls = params.get('security') === 'tls';
        } else {
            path = '/';
            sni = host;
        }
    } else return false;
    
    const protocol = isTls ? 'https' : 'http';
    const endpoint = `${protocol}://${host}:${port}${path}`;
    try {
        const res = await axios.get(endpoint, {
            headers: { 'Host': sni, 'Upgrade': 'websocket' },
            timeout: 2000,
            validateStatus: (status) => status < 500
        });
        // If we get any response (101, 200, 400, 401) the endpoint exists
        return true;
    } catch (err) {
        if (err.response && err.response.status < 500) return true;
        return false;
    }
}

async function getAccurateCountry(link) {
    // First try to get from domain name pattern
    const match = link.match(/@([^:]+):/);
    if (!match) return 'Unknown';
    const domain = match[1].toLowerCase();
    
    // Domain hints (most reliable)
    if (domain.includes('sg')) return 'Singapore';
    if (domain.includes('pk')) return 'Pakistan';
    if (domain.includes('de')) return 'Germany';
    if (domain.includes('nl')) return 'Netherlands';
    if (domain.includes('fr')) return 'France';
    if (domain.includes('jp')) return 'Japan';
    if (domain.includes('in')) return 'India';
    if (domain.includes('br')) return 'Brazil';
    if (domain.includes('ru')) return 'Russia';
    if (domain.includes('au')) return 'Australia';
    
    // Fallback to IP geolocation
    try {
        const ip = domain;
        const geo = await axios.get(`http://ip-api.com/json/${ip}`, { timeout: 2000 });
        if (geo.data && geo.data.country) return geo.data.country;
    } catch (e) {}
    
    // If domain contains 'us' or 'ca' but not others
    if (domain.includes('us')) return 'United States';
    if (domain.includes('ca')) return 'Canada';
    if (domain.includes('uk') || domain.includes('gb')) return 'United Kingdom';
    
    return 'Unknown';
        }
