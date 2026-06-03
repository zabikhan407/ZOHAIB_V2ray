const axios = require('axios');
const net = require('net');
const fs = require('fs');
const path = require('path');

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
    'https://raw.githubusercontent.com/Ptechgithub/Configs/main/AllConfigs.txt',
    'https://raw.githubusercontent.com/yebekhe/TelegramV2rayCollector/main/sub/normal.txt',
    'https://raw.githubusercontent.com/mahdibland/V2RayAggregator/master/sub/normal.txt'
];

async function scrape() {
    console.log('Fetching configs...');
    let allLinks = new Set();
    for (const src of SOURCES) {
        try {
            const resp = await axios.get(src, { timeout: 15000 });
            const lines = resp.data.split('\n');
            for (let line of lines) {
                line = line.trim();
                if ((line.startsWith('vless://') || line.startsWith('trojan://')) && line.includes('type=ws')) {
                    allLinks.add(line);
                }
            }
        } catch (e) {}
    }
    
    let configs = [...allLinks];
    console.log(`Total: ${configs.length}`);
    
    const results = [];
    const batchSize = 10;
    for (let i = 0; i < configs.length; i += batchSize) {
        const batch = configs.slice(i, i+batchSize);
        const batchResults = await Promise.all(batch.map(cfg => testConfig(cfg)));
        results.push(...batchResults.filter(r => r !== null && r.alive === true));
        console.log(`Tested ${Math.min(i+batchSize, configs.length)} - found ${results.length} alive`);
    }
    
    results.sort((a,b) => a.ping - b.ping);
    const outputPath = path.join(__dirname, '../public/configs.json');
    fs.writeFileSync(outputPath, JSON.stringify({ lastUpdated: new Date().toISOString(), total: results.length, configs: results }, null, 2));
    console.log(`Saved ${results.length} configs`);
}

async function testConfig(link) {
    const ping = await tcpPing(link);
    if (!ping || ping > 800) return null;
    const wsOk = await checkWebSocket(link);
    if (!wsOk) return null;
    const country = await getCountry(link);
    return { config: link, ping, alive: true, country };
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

async function checkWebSocket(link) {
    let host, port, path, sni, isTls = false;
    try {
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
    } catch(e) { return false; }
    
    const protocol = isTls ? 'https' : 'http';
    const endpoint = `${protocol}://${host}:${port}${path}`;
    try {
        const res = await axios.get(endpoint, {
            headers: { 'Host': sni, 'Upgrade': 'websocket' },
            timeout: 2000,
            validateStatus: (status) => status < 500
        });
        return true;
    } catch(err) {
        return err.response && err.response.status < 500;
    }
}

async function getCountry(link) {
    const match = link.match(/@([^:]+):/);
    if (!match) return 'Unknown';
    const domain = match[1].toLowerCase();
    if (domain.includes('sg')) return 'Singapore';
    if (domain.includes('pk')) return 'Pakistan';
    if (domain.includes('in')) return 'India';
    if (domain.includes('ae')) return 'UAE';
    if (domain.includes('sa')) return 'Saudi Arabia';
    if (domain.includes('de')) return 'Germany';
    if (domain.includes('nl')) return 'Netherlands';
    if (domain.includes('fr')) return 'France';
    if (domain.includes('jp')) return 'Japan';
    if (domain.includes('us')) return 'United States';
    if (domain.includes('ca')) return 'Canada';
    if (domain.includes('gb')) return 'United Kingdom';
    try {
        const geo = await axios.get(`http://ip-api.com/json/${domain}`, { timeout: 2000 });
        if (geo.data && geo.data.country) return geo.data.country;
    } catch(e) {}
    return 'Unknown';
}

scrape().catch(console.error);
