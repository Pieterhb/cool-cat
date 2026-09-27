// Cloudflare Pages Function: /api/settings
// Stores & retrieves global site config (room rates, next-year markup %, etc.) in Cloudflare KV.
// GET  /api/settings          → returns the current saved config object
// POST /api/settings          → saves/merges a config object
// OPTIONS /api/settings       → CORS preflight

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    'Pragma': 'no-cache'
};

// Default config — used when nothing has been saved yet
const DEFAULT_CONFIG = {
    nextYearMarkupPct: 10,
    king_wd:     950,
    king_we:    1200,
    santori_wd:  850,
    santori_we: 1100,
    mykonos_wd:  850,
    mykonos_we: 1100,
    deluxe_wd:  1350,
    deluxe_we:  1750
};

export async function onRequestGet(context) {
    const { env } = context;
    try {
        let config = { ...DEFAULT_CONFIG };
        if (env && env.COOLCAT_KV) {
            const saved = await env.COOLCAT_KV.get('site_config', { type: 'json' });
            if (saved && typeof saved === 'object') {
                config = { ...DEFAULT_CONFIG, ...saved };
            }
        }
        return new Response(JSON.stringify({ success: true, config }), { headers: CORS_HEADERS });
    } catch (err) {
        return new Response(JSON.stringify({ success: false, error: err.message, config: DEFAULT_CONFIG }), {
            status: 200,
            headers: CORS_HEADERS
        });
    }
}

export async function onRequestPost(context) {
    const { request, env } = context;
    try {
        const payload = await request.json();

        // Validate — only allow known numeric fields
        const allowed = ['nextYearMarkupPct', 'king_wd', 'king_we', 'santori_wd', 'santori_we',
                         'mykonos_wd', 'mykonos_we', 'deluxe_wd', 'deluxe_we'];

        const update = {};
        allowed.forEach(key => {
            if (payload[key] !== undefined) {
                update[key] = Number(payload[key]);
            }
        });

        if (Object.keys(update).length === 0) {
            return new Response(JSON.stringify({ success: false, error: 'No valid fields provided' }), {
                status: 400,
                headers: CORS_HEADERS
            });
        }

        let config = { ...DEFAULT_CONFIG };
        if (env && env.COOLCAT_KV) {
            const existing = await env.COOLCAT_KV.get('site_config', { type: 'json' });
            if (existing && typeof existing === 'object') {
                config = { ...DEFAULT_CONFIG, ...existing };
            }
            config = { ...config, ...update };
            await env.COOLCAT_KV.put('site_config', JSON.stringify(config));
        } else {
            // No KV bound (local dev) — just echo back
            config = { ...config, ...update };
        }

        return new Response(JSON.stringify({ success: true, config }), { headers: CORS_HEADERS });
    } catch (err) {
        return new Response(JSON.stringify({ success: false, error: err.message }), {
            status: 500,
            headers: CORS_HEADERS
        });
    }
}

export async function onRequestOptions(context) {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
}
