const axios = require('axios');
const net = require('net');

module.exports = async (req, res) => {
    try {
        // Sirf ek reliable source (fast aur stable)
        const url = 'https://raw.githubusercontent.com/4n0nymou3/multi-proxy-config-fetcher/main/configs/proxy_configs.txt';
        const response = await axios.get(url, { timeout: 8000 });
        const lines = response.data.split('\n');
        
        const configsSet = new Set();
        for (let line of lines) {
            line = line.trim();
            // Sirf WebSocket wale VLESS aur Trojan
            if ((line.startsWith('vless://') || line.startsWith('trojan://')) && line.includes('type=ws')) {
                configsSet.add(line);
            }
        }
        
        let configs = [...configsSet];
        // Pehle 40 configs test karenge (fast)
        const toTest = configs.slice(0, 40);
        const results = [];
        
        for (const cfg of toTest) {
            const ping = await tcpPing(cfg);
            const alive = (ping !== null && ping < 3000);
            let country = 'Unknown';
            if (alive) {
                country = await quickCountry(cfg);
            } else {
                country = guessCountry(cfg);
            }
            results.push({
                config: cfg,
                ping: alive ? ping : null,
                alive: alive,
                country: country
            });
        }
        
        // Alive configs pehle, phir ping ke hisaab se sort
        results.sort((a, b) => {
            if (a.alive !== b.alive) return b.alive - a.alive;
            return (a.ping || 9999) - (b.ping || 9999);
        });
        
        res.status(200).json({ status: 'success', total: results.length, configs: results });
    } catch (err) {
        // Kabhi bhi crash nahi hoga — hamesha JSON return karega
        res.status(200).json({ 
            status: 'success', 
            total: 0, 
            configs: [],
            error: err.message 
        });
    }
};

// TCP ping function (reliable)
function tcpPing(link) {
    return new Promise((resolve) => {
        const hostMatch = link.match(/@([^:]+):(\d+)/);
        if (!hostMatch) return resolve(null);
        const host = hostMatch[1];
        const port = parseInt(hostMatch[2], 10);
        const start = Date.now();
        const socket = new net.Socket();
        socket.setTimeout(2500);
        socket.connect(port, host, () => {
            const latency = Date.now() - start;
            socket.destroy();
            resolve(latency);
        });
        socket.on('timeout', () => { socket.destroy(); resolve(null); });
        socket.on('error', () => resolve(null));
    });
}

// Quick country lookup (timeout 1.5 sec)
async function quickCountry(link) {
    const match = link.match(/@([^:]+):/);
    if (!match) return 'Unknown';
    const domain = match[1];
    try {
        const geo = await axios.get(`http://ip-api.com/json/${domain}`, { timeout: 1500 });
        if (geo.data && geo.data.country) return geo.data.country;
    } catch (e) {}
    return guessCountry(link);
}

function guessCountry(link) {
    const match = link.match(/@([^:]+):/);
    if (!match) return 'Unknown';
    const host = match[1].toLowerCase();
    if (host.includes('sg')) return 'Singapore';
    if (host.includes('pk')) return 'Pakistan';
    if (host.includes('de')) return 'Germany';
    if (host.includes('us')) return 'United States';
    if (host.includes('ca')) return 'Canada';
    if (host.includes('jp')) return 'Japan';
    if (host.includes('in')) return 'India';
    if (host.includes('fr')) return 'France';
    if (host.includes('nl')) return 'Netherlands';
    if (host.includes('gb') || host.includes('uk')) return 'United Kingdom';
    return 'Unknown';
}
