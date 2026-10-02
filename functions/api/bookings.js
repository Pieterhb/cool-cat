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

        // Combine default with stored and sanitize any legacy manual test records in KV
        const allBookings = [...defaultBookings, ...storedBookings].filter(b => {
            // Filter out corrupted/ghost records with missing check-in dates
            if (!b.checkIn || typeof b.checkIn !== 'string' || b.checkIn.trim() === '' || b.checkIn === 'undefined' || b.checkIn === 'null') {
                return false;
            }
            return true;
        }).map(b => {
            // Only sanitize legacy manual draft records with explicit 'MAN-' prefix that have zero payment recorded
            const isUnpaidManual = b.isManual === true && b.id && b.id.startsWith('MAN-') && !b.isPaidEft && !b.isRecordedPayment && !b.paystackRef && Number(b.amountPaid || 0) === 0;
            if (isUnpaidManual) {
                if (b.status === 'cancelled') {
                    return {
                        ...b,
                        amountPaid: 0,
                        balanceDue: 0,
                        status: 'cancelled'
                    };
                }
                return {
                    ...b,
                    amountPaid: 0,
                    balanceDue: Number(b.totalAmount || 0),
                    status: 'not_paid',
                    paymentMethod: 'pending'
                };
            }
            return b;
        });

        const nextSequence = await getNextSequenceNumber(env, allBookings);

        return new Response(JSON.stringify({
            success: true,
            bookings: allBookings,
            nextSequence: nextSequence
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
            bookings: defaultBookings,
            nextSequence: 10001
        }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
    }
}

function getRoomPrefix(rId) {
    if (!rId) return 'CC-';
    const r = String(rId).toLowerCase();
    if (r === 'all' || r.includes('all')) return 'ALL-';
    if (r.includes('king') || r.includes('arthur') || r.includes('kin')) return 'KIN-';
    if (r.includes('santor') || r.includes('san')) return 'SAN-';
    if (r.includes('mykon') || r.includes('myk')) return 'MYK-';
    if (r.includes('deluxe') || r.includes('suite') || r.includes('del')) return 'DEL-';
    return 'CC-';
}

function getHighestSeqFromBookings(bookingsList) {
    let max = 10000;
    if (Array.isArray(bookingsList)) {
        bookingsList.forEach(b => {
            const idStr = String(b.id || b.parentBookingId || '');
            const m = idStr.match(/(?:ALL|KIN|SAN|MYK|DEL|MAN|CC)-(\d{5})/i);
            if (m) {
                const n = parseInt(m[1], 10);
                if (n >= 10001 && n > max) max = n;
            }
        });
    }
    return max;
}

async function getNextSequenceNumber(env, bookingsList) {
    let currentSeq = 10000;
    if (env && env.COOLCAT_KV) {
        try {
            const stored = await env.COOLCAT_KV.get('booking_seq');
            if (stored) {
                const parsed = parseInt(stored, 10);
                if (parsed >= 10000) currentSeq = parsed;
            }
        } catch (e) {}
    }
    const highestFromList = getHighestSeqFromBookings(bookingsList);
    const nextSeq = Math.max(currentSeq, highestFromList) + 1;
    return nextSeq;
}

async function updateSequenceNumber(env, seqNum) {
    if (env && env.COOLCAT_KV && seqNum >= 10001) {
        try {
            const currentStored = await env.COOLCAT_KV.get('booking_seq');
            const cur = currentStored ? parseInt(currentStored, 10) : 10000;
            if (seqNum > cur) {
                await env.COOLCAT_KV.put('booking_seq', String(seqNum));
            }
        } catch (e) {}
    }
}

export async function onRequestPost(context) {
    const { request, env } = context;

    try {
        const payload = await request.json();
        const { roomId, checkIn, checkOut, guestName, guestEmail, guestPhone, totalAmount, depositPaid, amountPaid, balanceDue, status, ref, id, paymentMethod } = payload;

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

        let existing = [];
        if (env && env.COOLCAT_KV) {
            existing = await env.COOLCAT_KV.get('bookings_list', { type: 'json' }) || [];
        }

        let bookingRef = id || ref;
        if (!bookingRef) {
            const nextSeq = await getNextSequenceNumber(env, existing);
            bookingRef = `${getRoomPrefix(roomId)}${nextSeq}`;
            await updateSequenceNumber(env, nextSeq);
        } else {
            const m = String(bookingRef).match(/(?:ALL|KIN|SAN|MYK|DEL|MAN|CC)-(\d{5})/i) || String(bookingRef).match(/(\d{5})/);
            if (m) {
                const seqVal = parseInt(m[1], 10);
                if (seqVal >= 10001) {
                    await updateSequenceNumber(env, seqVal);
                }
            }
        }
        const numTotal = Number(totalAmount || 0);
        const numPaid = Number(amountPaid !== undefined ? amountPaid : (depositPaid !== undefined ? depositPaid : 0));
        const numBalance = Number(balanceDue !== undefined ? balanceDue : (numTotal - numPaid));
        
        let finalStatus = status;
        if (!finalStatus) {
            if (numTotal > 0 && numPaid === 0) {
                finalStatus = 'not_paid';
            } else if (numBalance > 0 && numPaid > 0) {
                finalStatus = 'deposit_paid';
            } else if (numTotal > 0 && numBalance === 0 && numPaid > 0) {
                finalStatus = 'fully_paid';
            } else {
                finalStatus = 'not_paid';
            }
        }
        const nightsCount = payload.nights || Math.max(1, Math.round((new Date(checkOut) - new Date(checkIn)) / (1000 * 60 * 60 * 24)));

        const newBooking = {
            id: bookingRef,
            parentBookingId: null,
            isParentBooking: true,
            isManual: true,
            roomId,
            roomName: payload.roomName || roomNames[roomId] || roomId,
            checkIn,
            checkOut,
            nights: nightsCount,
            guestName: guestName || 'Direct / Owner Block',
            guestEmail: guestEmail || 'direct@cool-cat.co.za',
            guestPhone: guestPhone || '+27637124491',
            totalAmount: numTotal,
            amountPaid: numPaid,
            balanceDue: numBalance,
            paymentMethod: paymentMethod || (numPaid > 0 ? 'Card / Paystack' : 'pending'),
            status: finalStatus,
            createdAt: new Date().toISOString()
        };

        // If Cloudflare KV is available, save
        if (env && env.COOLCAT_KV) {
            let existing = await env.COOLCAT_KV.get('bookings_list', { type: 'json' }) || [];
            
            // If booking all rooms, store parent booking + 4 separate blocks so calendar locks all 4 rooms
            if (roomId === 'all') {
                existing.push(newBooking);
                const individualRooms = ['king-arthur', 'santori', 'mykonos', 'deluxe-suite'];
                individualRooms.forEach(r => {
                    existing.push({
                        id: `${bookingRef}_${r}`,
                        parentBookingId: bookingRef,
                        isCalendarBlock: true,
                        roomId: r,
                        roomName: roomNames[r],
                        checkIn,
                        checkOut,
                        nights: nightsCount,
                        guestName: newBooking.guestName,
                        guestEmail: newBooking.guestEmail,
                        guestPhone: newBooking.guestPhone,
                        totalAmount: 0,
                        amountPaid: 0,
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
    const action = url.searchParams.get('action');

    // Action: Reset all bookings to empty list
    if (action === 'reset_all') {
        try {
            if (env && env.COOLCAT_KV) {
                await env.COOLCAT_KV.put('bookings_list', JSON.stringify([]));
                await env.COOLCAT_KV.put('booking_seq', '10000');
            }
            return new Response(JSON.stringify({ success: true, message: "All bookings permanently reset. Database is now clean." }), {
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
            });
        } catch (err) {
            return new Response(JSON.stringify({ success: false, error: err.message }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    }

    // Action: Purge corrupted ghost records (missing check-in dates or orphaned test fragments)
    if (action === 'purge_ghosts') {
        try {
            if (env && env.COOLCAT_KV) {
                let existing = await env.COOLCAT_KV.get('bookings_list', { type: 'json' }) || [];
                const beforeCount = existing.length;
                existing = existing.filter(b => {
                    if (!b.checkIn || typeof b.checkIn !== 'string' || b.checkIn.trim() === '' || b.checkIn === 'undefined' || b.checkIn === 'null') {
                        return false;
                    }
                    return true;
                });
                const purgedCount = beforeCount - existing.length;
                await env.COOLCAT_KV.put('bookings_list', JSON.stringify(existing));
                return new Response(JSON.stringify({ success: true, purgedCount, message: `Purged ${purgedCount} ghost record(s).` }), {
                    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
                });
            }
            return new Response(JSON.stringify({ success: true, purgedCount: 0, message: "No records to purge." }), {
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
            });
        } catch (err) {
            return new Response(JSON.stringify({ success: false, error: err.message }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    }

    let id = url.searchParams.get('id');
    const isHardDelete = (url.searchParams.get('hard') === 'true');

    if (!id) {
        try {
            const body = await request.json();
            id = body.id;
        } catch (e) {}
    }

    if (!id) {
        return new Response(JSON.stringify({ success: false, error: "Booking ID or action is required" }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    try {
        if (env && env.COOLCAT_KV) {
            let existing = await env.COOLCAT_KV.get('bookings_list', { type: 'json' }) || [];
            const baseId = id.replace(/_(king-arthur|santori|mykonos|deluxe-suite|all)$/, '');

            if (isHardDelete) {
                // Permanently remove matching parent, children with parentBookingId, or prefixed room blocks
                existing = existing.filter(b => {
                    const bBase = (b.parentBookingId || b.id).replace(/_(king-arthur|santori|mykonos|deluxe-suite|all)$/, '');
                    return b.id !== id && b.parentBookingId !== id && bBase !== baseId;
                });
            } else {
                // Soft Cancel: Mark status as cancelled to free calendar inventory while preserving audit history
                existing = existing.map(b => {
                    const bBase = (b.parentBookingId || b.id).replace(/_(king-arthur|santori|mykonos|deluxe-suite|all)$/, '');
                    if (b.id === id || b.parentBookingId === id || bBase === baseId) {
                        return {
                            ...b,
                            status: 'cancelled',
                            cancelledAt: new Date().toISOString(),
                            balanceDue: 0
                        };
                    }
                    return b;
                });
            }
            await env.COOLCAT_KV.put('bookings_list', JSON.stringify(existing));
        }

        return new Response(JSON.stringify({
            success: true,
            message: isHardDelete ? `Booking #${id} permanently deleted.` : `Booking #${id} soft-cancelled. Room dates freed.`
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
        const { id, status, amountPaid, balanceDue, paymentMethod, isPaidEft } = payload;

        if (!id) {
            return new Response(JSON.stringify({ success: false, error: "Booking ID is required" }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        if (env && env.COOLCAT_KV) {
            let existing = await env.COOLCAT_KV.get('bookings_list', { type: 'json' }) || [];
            let updated = false;

            const baseId = id.replace(/_(king-arthur|santori|mykonos|deluxe-suite|all)$/, '');

            existing = existing.map(b => {
                const bBase = (b.parentBookingId || b.id).replace(/_(king-arthur|santori|mykonos|deluxe-suite|all)$/, '');
                if (b.id === id || b.parentBookingId === id || bBase === baseId) {
                    updated = true;
                    if (b.isCalendarBlock) {
                        return {
                            ...b,
                            status: status || b.status
                        };
                    }
                    const newAmountPaid = amountPaid !== undefined ? Number(amountPaid) : b.amountPaid;
                    // Mark isRecordedPayment=true when a real payment amount is recorded so the GET sanitizer
                    // knows NOT to zero out this booking's payment data on next load
                    const wasPaymentRecorded = newAmountPaid > 0;
                    return {
                        ...b,
                        status: status || b.status,
                        amountPaid: newAmountPaid,
                        balanceDue: balanceDue !== undefined ? Number(balanceDue) : b.balanceDue,
                        paymentMethod: paymentMethod !== undefined ? paymentMethod : b.paymentMethod,
                        isPaidEft: isPaidEft !== undefined ? isPaidEft : b.isPaidEft,
                        isRecordedPayment: wasPaymentRecorded ? true : (b.isRecordedPayment || false)
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
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
    }
}

export async function onRequestOptions() {
    return new Response(null, {
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        }
    });
}

