// Cloudflare Pages Function: /api/bookings
// Handles GET (retrieve active bookings) & POST (create pending/manual booking)

export async function onRequestGet(context) {
    const { env } = context;

    // Standard initial seed bookings
    const defaultBookings = [
        { roomId: 'king-arthur', checkIn: '2026-08-28', checkOut: '2026-08-31', status: 'confirmed' },
        { roomId: 'santori', checkIn: '2026-08-29', checkOut: '2026-09-02', status: 'confirmed' },
        { roomId: 'mykonos', checkIn: '2026-08-29', checkOut: '2026-09-01', status: 'confirmed' },
        { roomId: 'deluxe-suite', checkIn: '2026-08-29', checkOut: '2026-08-31', status: 'confirmed' },
        { roomId: 'king-arthur', checkIn: '2026-09-11', checkOut: '2026-09-14', status: 'confirmed' },
        { roomId: 'santori', checkIn: '2026-09-18', checkOut: '2026-09-22', status: 'confirmed' },
        { roomId: 'mykonos', checkIn: '2026-09-18', checkOut: '2026-09-21', status: 'confirmed' },
        { roomId: 'deluxe-suite', checkIn: '2026-09-24', checkOut: '2026-09-28', status: 'confirmed' },
        { roomId: 'king-arthur', checkIn: '2026-12-23', checkOut: '2026-12-28', status: 'confirmed' },
        { roomId: 'santori', checkIn: '2026-12-24', checkOut: '2026-12-29', status: 'confirmed' },
        { roomId: 'mykonos', checkIn: '2026-12-24', checkOut: '2026-12-28', status: 'confirmed' },
        { roomId: 'deluxe-suite', checkIn: '2026-12-22', checkOut: '2026-12-27', status: 'confirmed' }
    ];

    try {
        let storedBookings = [];

        // Check if Cloudflare KV is bound
        if (env && env.COOLCAT_KV) {
            const data = await env.COOLCAT_KV.get('bookings_list', { type: 'json' });
            if (data && Array.isArray(data)) {
                storedBookings = data;
            }
        }

        // Combine default with stored
        const allBookings = [...defaultBookings, ...storedBookings];

        return new Response(JSON.stringify({
            success: true,
            bookings: allBookings
        }), {
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
    } catch (err) {
        return new Response(JSON.stringify({
            success: false,
            error: err.message,
            bookings: defaultBookings
        }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
    }
}

export async function onRequestPost(context) {
    const { request, env } = context;

    try {
        const payload = await request.json();
        const { roomId, checkIn, checkOut, guestName, guestEmail, guestPhone, totalAmount, depositPaid, ref } = payload;

        if (!roomId || !checkIn || !checkOut || !guestEmail) {
            return new Response(JSON.stringify({ success: false, error: "Missing required booking fields" }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const newBooking = {
            id: ref || 'CC-' + Math.floor(Math.random() * 899999 + 100000),
            roomId,
            checkIn,
            checkOut,
            guestName,
            guestEmail,
            guestPhone,
            totalAmount,
            depositPaid,
            balanceDue: (totalAmount || 0) - (depositPaid || 0),
            status: 'confirmed',
            createdAt: new Date().toISOString()
        };

        // If Cloudflare KV is available, save
        if (env && env.COOLCAT_KV) {
            let existing = await env.COOLCAT_KV.get('bookings_list', { type: 'json' }) || [];
            existing.push(newBooking);
            await env.COOLCAT_KV.put('bookings_list', JSON.stringify(existing));
        }

        return new Response(JSON.stringify({
            success: true,
            booking: newBooking
        }), {
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
    } catch (err) {
        return new Response(JSON.stringify({ success: false, error: err.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
