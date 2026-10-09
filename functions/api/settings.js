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

// Default config – used when nothing has been saved yet
// Default config – used when nothing has been saved yet
const DEFAULT_CONFIG = {
    nextYearMarkupPct: 10,
    // Mid Season (Standard Base Rates)
    king_wd:     950,
    king_we:    1200,
    santori_wd:  850,
    santori_we: 1100,
    mykonos_wd:  850,
    mykonos_we: 1100,
    deluxe_wd:  1350,
    deluxe_we:  1750,

    // Low Season (May-Aug)
    low_king_wd:     808,
    low_king_we:    1020,
    low_santori_wd:  723,
    low_santori_we:  935,
    low_mykonos_wd:  723,
    low_mykonos_we:  935,
    low_deluxe_wd:  1148,
    low_deluxe_we:  1488,

    // Peak Season (Dec 1-15 & Easter)
    peak_king_wd:    1283,
    peak_king_we:    1620,
    peak_santori_wd: 1148,
    peak_santori_we: 1485,
    peak_mykonos_wd: 1148,
    peak_mykonos_we: 1485,
    peak_deluxe_wd:  1823,
    peak_deluxe_we:  2363,

    // Festive High Peak (Dec 16-Jan 10)
    festive_king_wd:    1710,
    festive_king_we:    2160,
    festive_santori_wd: 1530,
    festive_santori_we: 1980,
    festive_mykonos_wd: 1530,
    festive_mykonos_we: 1980,
    festive_deluxe_wd:  2430,
    festive_deluxe_we:  3150,

    // Active Specials Overrides (Discounts)
    special_king_active: false,
    special_king_start: '',
    special_king_end: '',
    special_king_rate: 650,

    special_santori_active: false,
    special_santori_start: '',
    special_santori_end: '',
    special_santori_rate: 599,

    special_mykonos_active: false,
    special_mykonos_start: '',
    special_mykonos_end: '',
    special_mykonos_rate: 599,

    special_deluxe_active: false,
    special_deluxe_start: '',
    special_deluxe_end: '',
    special_deluxe_rate: 990,

    // High-Demand & Event Surcharges (Event Surges)
    event_surge_name: '',
    event_king_active: false,
    event_king_start: '',
    event_king_end: '',
    event_king_rate: 1300,

    event_santori_active: false,
    event_santori_start: '',
    event_santori_end: '',
    event_santori_rate: 1100,

    event_mykonos_active: false,
    event_mykonos_start: '',
    event_mykonos_end: '',
    event_mykonos_rate: 1100,

    event_deluxe_active: false,
    event_deluxe_start: '',
    event_deluxe_end: '',
    event_deluxe_rate: 1700,

    // Package discounts (0% - 100%)
    pkg_discount_four: 0,
    pkg_discount_three: 0
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

        const allowedNumeric = [
            'nextYearMarkupPct',
            'king_wd', 'king_we', 'santori_wd', 'santori_we', 'mykonos_wd', 'mykonos_we', 'deluxe_wd', 'deluxe_we',
            'low_king_wd', 'low_king_we', 'low_santori_wd', 'low_santori_we', 'low_mykonos_wd', 'low_mykonos_we', 'low_deluxe_wd', 'low_deluxe_we',
            'peak_king_wd', 'peak_king_we', 'peak_santori_wd', 'peak_santori_we', 'peak_mykonos_wd', 'peak_mykonos_we', 'peak_deluxe_wd', 'peak_deluxe_we',
            'festive_king_wd', 'festive_king_we', 'festive_santori_wd', 'festive_santori_we', 'festive_mykonos_wd', 'festive_mykonos_we', 'festive_deluxe_wd', 'festive_deluxe_we',
            'special_king_rate', 'special_santori_rate', 'special_mykonos_rate', 'special_deluxe_rate',
            'event_king_rate', 'event_santori_rate', 'event_mykonos_rate', 'event_deluxe_rate',
            'pkg_discount_four', 'pkg_discount_three'
        ];

        const allowedBoolean = [
            'special_king_active', 'special_santori_active', 'special_mykonos_active', 'special_deluxe_active',
            'event_king_active', 'event_santori_active', 'event_mykonos_active', 'event_deluxe_active'
        ];

        const allowedString = [
            'special_king_start', 'special_king_end', 'special_santori_start', 'special_santori_end',
            'special_mykonos_start', 'special_mykonos_end', 'special_deluxe_start', 'special_deluxe_end',
            'event_surge_name',
            'event_king_start', 'event_king_end', 'event_santori_start', 'event_santori_end',
            'event_mykonos_start', 'event_mykonos_end', 'event_deluxe_start', 'event_deluxe_end'
        ];

        const update = {};
        if (Array.isArray(payload.marketer_payouts)) {
            update.marketer_payouts = payload.marketer_payouts;
        }
        allowedNumeric.forEach(key => {
            if (payload[key] !== undefined) {
                update[key] = Number(payload[key]);
            }
        });
        allowedBoolean.forEach(key => {
            if (payload[key] !== undefined) {
                update[key] = (payload[key] === true || payload[key] === 'true');
            }
        });
        allowedString.forEach(key => {
            if (payload[key] !== undefined) {
                update[key] = String(payload[key]).trim().replace(/\//g, '-');
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
            // No KV bound (local dev) – just echo back
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
