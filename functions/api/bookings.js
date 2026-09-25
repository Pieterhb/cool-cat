// Cloudflare Pages Function: /api/bookings
// Handles GET (retrieve active bookings), POST (create/block booking), DELETE (cancel booking), and PUT (update status)

export async function onRequestGet(context) {
    const { env } = context;

    // Initial bookings (empty by default; populated via live bookings & admin in Cloudflare KV)
    const defaultBookings = [];

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
            // Remove matching parent, children with parentBookingId, or prefixed room blocks
            const baseId = id.replace(/_(king-arthur|santori|mykonos|deluxe-suite|all)$/, '');
            existing = existing.filter(b => {
                const bBase = (b.parentBookingId || b.id).replace(/_(king-arthur|santori|mykonos|deluxe-suite|all)$/, '');
                return b.id !== id && b.parentBookingId !== id && bBase !== baseId;
            });
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

