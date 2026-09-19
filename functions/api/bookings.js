// Cloudflare Pages Function: /api/bookings
// Handles GET (retrieve active bookings), POST (create/block booking), DELETE (cancel booking), and PUT (update status)

export async function onRequestGet(context) {
    const { env } = context;

    // Standard initial seed bookings
    const defaultBookings = [
        { id: 'SEED-101', roomId: 'king-arthur', roomName: 'King Arthur Room', checkIn: '2026-08-28', checkOut: '2026-08-31', nights: 3, guestName: 'Johan Becker', guestEmail: 'johan@example.com', guestPhone: '+27821112233', totalAmount: 2850, amountPaid: 2850, balanceDue: 0, status: 'confirmed' },
        { id: 'SEED-102', roomId: 'santori', roomName: 'Santori Room', checkIn: '2026-08-29', checkOut: '2026-09-02', nights: 4, guestName: 'Annelize Meyer', guestEmail: 'annelize@example.com', guestPhone: '+27832223344', totalAmount: 3400, amountPaid: 3400, balanceDue: 0, status: 'confirmed' },
        { id: 'SEED-103', roomId: 'mykonos', roomName: 'Mykonos Room', checkIn: '2026-08-29', checkOut: '2026-09-01', nights: 3, guestName: 'David Ndebele', guestEmail: 'david@example.com', guestPhone: '+27843334455', totalAmount: 2550, amountPaid: 2550, balanceDue: 0, status: 'confirmed' },
        { id: 'SEED-104', roomId: 'deluxe-suite', roomName: 'Cool-Cat Deluxe Suite', checkIn: '2026-08-29', checkOut: '2026-08-31', nights: 2, guestName: 'Klaus Mueller', guestEmail: 'klaus@example.com', guestPhone: '+27854445566', totalAmount: 2700, amountPaid: 2700, balanceDue: 0, status: 'confirmed' },
        { id: 'SEED-105', roomId: 'king-arthur', roomName: 'King Arthur Room', checkIn: '2026-09-11', checkOut: '2026-09-14', nights: 3, guestName: 'Willem Pretorius', guestEmail: 'willem@example.com', guestPhone: '+27825556677', totalAmount: 2850, amountPaid: 2850, balanceDue: 0, status: 'confirmed' },
        { id: 'SEED-106', roomId: 'santori', roomName: 'Santori Room', checkIn: '2026-09-18', checkOut: '2026-09-22', nights: 4, guestName: 'Charmaine Smit', guestEmail: 'charmaine@example.com', guestPhone: '+27836667788', totalAmount: 3400, amountPaid: 3400, balanceDue: 0, status: 'confirmed' },
        { id: 'SEED-107', roomId: 'mykonos', roomName: 'Mykonos Room', checkIn: '2026-09-18', checkOut: '2026-09-21', nights: 3, guestName: 'Brian O\'Connor', guestEmail: 'brian@example.com', guestPhone: '+27847778899', totalAmount: 2550, amountPaid: 2550, balanceDue: 0, status: 'confirmed' },
        { id: 'SEED-108', roomId: 'deluxe-suite', roomName: 'Cool-Cat Deluxe Suite', checkIn: '2026-09-24', checkOut: '2026-09-28', nights: 4, guestName: 'Francois Du Plessis', guestEmail: 'francois@example.com', guestPhone: '+27828889900', totalAmount: 5400, amountPaid: 2700, balanceDue: 2700, status: 'deposit_paid' },
        { id: 'SEED-109', roomId: 'king-arthur', roomName: 'King Arthur Room', checkIn: '2026-12-23', checkOut: '2026-12-28', nights: 5, guestName: 'Gareth Evans', guestEmail: 'gareth@example.com', guestPhone: '+27839990011', totalAmount: 8550, amountPaid: 8550, balanceDue: 0, status: 'confirmed' },
        { id: 'SEED-110', roomId: 'santori', roomName: 'Santori Room', checkIn: '2026-12-24', checkOut: '2026-12-29', nights: 5, guestName: 'Estelle Visser', guestEmail: 'estelle@example.com', guestPhone: '+27840001122', totalAmount: 7650, amountPaid: 7650, balanceDue: 0, status: 'confirmed' },
        { id: 'SEED-111', roomId: 'mykonos', roomName: 'Mykonos Room', checkIn: '2026-12-24', checkOut: '2026-12-28', nights: 4, guestName: 'Markus Botha', guestEmail: 'markus@example.com', guestPhone: '+27851112233', totalAmount: 6120, amountPaid: 6120, balanceDue: 0, status: 'confirmed' },
        { id: 'SEED-112', roomId: 'deluxe-suite', roomName: 'Cool-Cat Deluxe Suite', checkIn: '2026-12-22', checkOut: '2026-12-27', nights: 5, guestName: 'Dr. Hein Joubert', guestEmail: 'hein@example.com', guestPhone: '+27822223344', totalAmount: 12150, amountPaid: 12150, balanceDue: 0, status: 'confirmed' }
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
        const { roomId, checkIn, checkOut, guestName, guestEmail, guestPhone, totalAmount, depositPaid, amountPaid, balanceDue, status, ref, id } = payload;

        if (!roomId || !checkIn || !checkOut) {
            return new Response(JSON.stringify({ success: false, error: "Missing required booking fields (roomId, checkIn, checkOut)" }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const roomNames = {
            'all': 'All 4 Rooms (Entire Property)',
            'king-arthur': 'King Arthur Room',
            'santori': 'Santori Room',
            'mykonos': 'Mykonos Room',
            'deluxe-suite': 'Cool-Cat Deluxe Suite'
        };

        const bookingRef = id || ref || ('CC-' + Math.floor(Math.random() * 899999 + 100000));
        const finalStatus = status || (balanceDue > 0 ? 'deposit_paid' : 'confirmed');
        const nightsCount = payload.nights || Math.max(1, Math.round((new Date(checkOut) - new Date(checkIn)) / (1000 * 60 * 60 * 24)));

        const newBooking = {
            id: bookingRef,
            roomId,
            roomName: payload.roomName || roomNames[roomId] || roomId,
            checkIn,
            checkOut,
            nights: nightsCount,
            guestName: guestName || 'Direct / Owner Block',
            guestEmail: guestEmail || 'direct@cool-cat.co.za',
            guestPhone: guestPhone || '+27637124491',
            totalAmount: Number(totalAmount || 0),
            amountPaid: Number(amountPaid || depositPaid || totalAmount || 0),
            balanceDue: Number(balanceDue !== undefined ? balanceDue : (Number(totalAmount || 0) - Number(depositPaid || amountPaid || 0))),
            status: finalStatus,
            createdAt: new Date().toISOString()
        };

        // If Cloudflare KV is available, save
        if (env && env.COOLCAT_KV) {
            let existing = await env.COOLCAT_KV.get('bookings_list', { type: 'json' }) || [];
            
            // If booking all rooms, store 4 separate blocks so calendar locks all 4 rooms
            if (roomId === 'all') {
                const individualRooms = ['king-arthur', 'santori', 'mykonos', 'deluxe-suite'];
                individualRooms.forEach(r => {
                    existing.push({
                        id: `${bookingRef}_${r}`,
                        parentBookingId: bookingRef,
                        roomId: r,
                        roomName: roomNames[r],
                        checkIn,
                        checkOut,
                        nights: nightsCount,
                        guestName: newBooking.guestName,
                        guestEmail: newBooking.guestEmail,
                        guestPhone: newBooking.guestPhone,
                        totalAmount: newBooking.totalAmount / 4,
                        amountPaid: newBooking.amountPaid / 4,
                        balanceDue: 0,
                        status: finalStatus,
                        createdAt: new Date().toISOString()
                    });
                });
            } else {
                existing.push(newBooking);
            }

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

export async function onRequestDelete(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    let id = url.searchParams.get('id');

    if (!id) {
        try {
            const body = await request.json();
            id = body.id;
        } catch (e) {}
    }

    if (!id) {
        return new Response(JSON.stringify({ success: false, error: "Booking ID is required" }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    try {
        if (env && env.COOLCAT_KV) {
            let existing = await env.COOLCAT_KV.get('bookings_list', { type: 'json' }) || [];
            existing = existing.filter(b => b.id !== id && b.parentBookingId !== id);
            await env.COOLCAT_KV.put('bookings_list', JSON.stringify(existing));
        }

        return new Response(JSON.stringify({
            success: true,
            message: `Booking #${id} deleted successfully.`
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

export async function onRequestPut(context) {
    const { request, env } = context;

    try {
        const payload = await request.json();
        const { id, status, amountPaid, balanceDue } = payload;

        if (!id) {
            return new Response(JSON.stringify({ success: false, error: "Booking ID is required" }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        if (env && env.COOLCAT_KV) {
            let existing = await env.COOLCAT_KV.get('bookings_list', { type: 'json' }) || [];
            let updated = false;

            existing = existing.map(b => {
                if (b.id === id || b.parentBookingId === id) {
                    updated = true;
                    return {
                        ...b,
                        status: status || b.status,
                        amountPaid: amountPaid !== undefined ? amountPaid : b.amountPaid,
                        balanceDue: balanceDue !== undefined ? balanceDue : b.balanceDue
                    };
                }
                return b;
            });

            if (updated) {
                await env.COOLCAT_KV.put('bookings_list', JSON.stringify(existing));
            }
        }

        return new Response(JSON.stringify({
            success: true,
            message: `Booking #${id} updated successfully.`
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

