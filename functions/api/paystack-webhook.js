// Cloudflare Pages Function: /api/paystack-webhook
// Handles server-to-server Paystack webhooks (e.g. charge.success) with crypto verification

export async function onRequestPost(context) {
    const { request, env } = context;

    try {
        const bodyText = await request.text();
        const signature = request.headers.get('x-paystack-signature');
        const paystackSecret = (env && env.PAYSTACK_SECRET_KEY) ? env.PAYSTACK_SECRET_KEY : null;

        // Verify HMAC SHA512 signature if secret key is configured
        if (paystackSecret) {
            if (!signature) {
                return new Response(JSON.stringify({ error: "Missing x-paystack-signature header" }), {
                    status: 401,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            const hexMatches = signature.match(/.{1,2}/g);
            if (!hexMatches || hexMatches.length !== 64) {
                return new Response(JSON.stringify({ error: "Invalid Paystack webhook signature format" }), {
                    status: 401,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            const encoder = new TextEncoder();
            const key = await crypto.subtle.importKey(
                'raw',
                encoder.encode(paystackSecret),
                { name: 'HMAC', hash: 'SHA-512' },
                false,
                ['verify']
            );

            // Convert signature hex to Uint8Array
            const sigBytes = new Uint8Array(
                hexMatches.map(byte => parseInt(byte, 16))
            );

            const isValid = await crypto.subtle.verify(
                'HMAC',
                key,
                sigBytes,
                encoder.encode(bodyText)
            );

            if (!isValid) {
                return new Response(JSON.stringify({ error: "Invalid Paystack webhook signature" }), {
                    status: 401,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
        }

        const event = JSON.parse(bodyText);

        if (event && event.event === 'charge.success') {
            const data = event.data || {};
            const rawRef = data.reference || '';
            const metadata = data.metadata || {};

            // Extract booking reference from top-level metadata, custom_fields, or payment reference
            let bookingRefMeta = metadata.booking_ref || '';
            if (!bookingRefMeta && Array.isArray(metadata.custom_fields)) {
                const cf = metadata.custom_fields.find(f => f.variable_name === 'booking_ref');
                if (cf && cf.value) bookingRefMeta = cf.value;
            }
            if (!bookingRefMeta && String(rawRef).startsWith('PAY_')) {
                bookingRefMeta = String(rawRef).replace(/^PAY_/, '').replace(/_\d{3,}$/, '');
            }

            const cleanBookingRef = (bookingRefMeta || String(rawRef).replace(/_\d{5,}$/, '')).trim();
            const amountInZar = Number(data.amount) / 100;
            const customerEmail = data.customer ? data.customer.email : (metadata.email || '');

            let guestName = metadata.guest_name || '';
            if (!guestName && Array.isArray(metadata.custom_fields)) {
                const cf = metadata.custom_fields.find(f => f.variable_name === 'guest_name');
                if (cf && cf.value) guestName = cf.value;
            }
            if (!guestName) guestName = 'Guest';

            let phone = metadata.phone || '';
            if (!phone && Array.isArray(metadata.custom_fields)) {
                const cf = metadata.custom_fields.find(f => f.variable_name === 'phone');
                if (cf && cf.value) phone = cf.value;
            }

            const checkIn = metadata.check_in || '';
            const checkOut = metadata.check_out || '';
            let staysList = [];
            if (metadata.stays_json) {
                try {
                    staysList = typeof metadata.stays_json === 'string' ? JSON.parse(metadata.stays_json) : metadata.stays_json;
                } catch(e) {}
            }

            // Derive room info from metadata (roomId was previously undefined - fixed)
            const metaRoomId = metadata.room_id || (staysList.length === 1 ? staysList[0].roomId : 'multiple');
            const isAllRooms = (metaRoomId === 'all') || (Array.isArray(staysList) && staysList.some(s => s.roomId === 'all'));
            const parentRoomId = isAllRooms ? 'all' : (staysList.length === 1 ? staysList[0].roomId : (metaRoomId || 'multiple'));
            const defaultDisplayRoomName = isAllRooms
                ? 'All 4 Rooms (Entire Property)'
                : (staysList.length === 1 ? (staysList[0].roomName || 'Single Room') : (staysList.length > 1 ? `${staysList.length} Reserved Stays` : 'All 4 Rooms (Entire Property)'));
            const finalRoomName = metadata.room_name && !metadata.room_name.includes('3 Suites') ? metadata.room_name : defaultDisplayRoomName;
            // Derive amounts and status from payment data (totalAmount/balanceDue/status were undefined - fixed)
            const totalAmountMeta = Number(metadata.total_amount || 0);
            const amountPaidMeta = amountInZar;
            const balanceDueMeta = Math.max(0, totalAmountMeta - amountPaidMeta);
            const bookingStatus = balanceDueMeta > 0 ? 'deposit_paid' : (amountPaidMeta > 0 ? 'fully_paid' : 'not_paid');

            console.log(`Paystack Webhook Success: Ref ${cleanBookingRef} (tx: ${rawRef}) | R${amountInZar} | Customer: ${customerEmail}`);

            const calculatedNights = (staysList && staysList.length > 0)
                ? staysList.reduce((sum, s) => sum + (Number(s.nights) || 0), 0)
                : (() => {
                    const [cInY, cInM, cInD] = String(checkIn || '').split('T')[0].split('-').map(Number);
                    const [cOutY, cOutM, cOutD] = String(checkOut || '').split('T')[0].split('-').map(Number);
                    return (cInY && cOutY) ? Math.max(1, Math.round((Date.UTC(cOutY, cOutM - 1, cOutD) - Date.UTC(cInY, cInM - 1, cInD)) / 86400000)) : 1;
                })();

            // Save confirmed booking to KV if available
            if (env && env.COOLCAT_KV) {
                let existing = await env.COOLCAT_KV.get('bookings_list', { type: 'json' }) || [];
                const parentRecord = {
                    id: cleanBookingRef,
                    parentBookingId: null,
                    isParentBooking: true,
                    roomId: parentRoomId,
                    roomName: finalRoomName,
                    checkIn: checkIn,
                    checkOut: checkOut,
                    nights: calculatedNights,
                    guestName: guestName,
                    guestEmail: customerEmail,
                    guestPhone: phone,
                    totalAmount: totalAmountMeta,
                    amountPaid: amountPaidMeta,
                    balanceDue: balanceDueMeta,
                    paymentMethod: 'card',
                    paystackRef: rawRef,
                    isRecordedPayment: true,
                    isPaidPaystack: true,
                    stays: (staysList && staysList.length > 0) ? staysList : undefined,
                    totalStays: (staysList && staysList.length > 0) ? staysList.length : 1,
                    status: bookingStatus,
                    createdAt: new Date().toISOString()
                };

                const foundIndex = existing.findIndex(b => b.id === cleanBookingRef || b.id === rawRef || b.paystackRef === rawRef);
                if (foundIndex >= 0) {
                    const ex = existing[foundIndex];
                    const newAmountPaid = (Number(ex.amountPaid) || 0) + amountInZar;
                    const tot = Number(ex.totalAmount) || totalAmountMeta || amountInZar;
                    const newBal = Math.max(0, tot - newAmountPaid);
                    const newStat = (newBal === 0) ? 'fully_paid' : 'deposit_paid';
                    existing[foundIndex] = {
                        ...ex,
                        totalAmount: tot,
                        amountPaid: newAmountPaid,
                        balanceDue: newBal,
                        status: newStat,
                        paymentMethod: 'card',
                        paystackRef: rawRef,
                        isRecordedPayment: true,
                        isPaidPaystack: true,
                        guestEmail: ex.guestEmail || customerEmail,
                        guestPhone: ex.guestPhone || phone,
                        checkIn: ex.checkIn || checkIn,
                        checkOut: ex.checkOut || checkOut,
                        roomId: ex.roomId || parentRoomId,
                        roomName: ex.roomName || finalRoomName,
                        createdAt: ex.createdAt || parentRecord.createdAt
                    };
                } else {
                    existing.push(parentRecord);
                }

                // Remove existing calendar blocks for this booking ref
                existing = existing.filter(b => b.parentBookingId !== cleanBookingRef && b.parentBookingId !== rawRef);

                // Generate fresh calendar block records
                if (staysList && Array.isArray(staysList) && staysList.length > 0) {
                    staysList.forEach(s => {
                        const stayRooms = s.roomId === 'all'
                            ? ['king-arthur', 'santori', 'deluxe-suite']
                            : (s.roomId === 'three-rooms' ? ['king-arthur', 'santori'] : [s.roomId]);
                        stayRooms.forEach(rid => {
                            existing.push({
                                id: `${cleanBookingRef}_${rid}_${s.checkInStr || s.checkIn}`,
                                parentBookingId: cleanBookingRef,
                                isCalendarBlock: true,
                                roomId: rid,
                                roomName: s.roomName || rid,
                                checkIn: s.checkInStr || s.checkIn,
                                checkOut: s.checkOutStr || s.checkOut,
                                nights: s.nights || 1,
                                guestName: guestName,
                                guestEmail: customerEmail,
                                guestPhone: phone,
                                totalAmount: 0,
                                amountPaid: 0,
                                balanceDue: 0,
                                status: bookingStatus,
                                createdAt: new Date().toISOString()
                            });
                        });
                    });
                } else if (isAllRooms) {
                    // Single All Rooms booking without explicit stays array: block all 4 rooms
                    ['king-arthur', 'santori', 'deluxe-suite'].forEach(rid => {
                        existing.push({
                            id: `${cleanBookingRef}_${rid}_${checkIn}`,
                            parentBookingId: cleanBookingRef,
                            isCalendarBlock: true,
                            roomId: rid,
                            roomName: finalRoomName,
                            checkIn: checkIn,
                            checkOut: checkOut,
                            guestName: guestName,
                            guestEmail: customerEmail,
                            guestPhone: phone,
                            totalAmount: 0,
                            amountPaid: 0,
                            balanceDue: 0,
                            status: bookingStatus,
                            createdAt: new Date().toISOString()
                        });
                    });
                } else if (parentRoomId && parentRoomId !== 'multiple') {
                    // Single room booking: ensure calendar block exists
                    existing.push({
                        id: `${cleanBookingRef}_${parentRoomId}_${checkIn}`,
                        parentBookingId: cleanBookingRef,
                        isCalendarBlock: true,
                        roomId: parentRoomId,
                        roomName: finalRoomName,
                        checkIn: checkIn,
                        checkOut: checkOut,
                        guestName: guestName,
                        guestEmail: customerEmail,
                        guestPhone: phone,
                        totalAmount: 0,
                        amountPaid: 0,
                        balanceDue: 0,
                        status: bookingStatus,
                        createdAt: new Date().toISOString()
                    });
                }

                await env.COOLCAT_KV.put('bookings_list', JSON.stringify(existing));

                const numMatch = String(cleanBookingRef).match(/(?:ALL|KIN|SAN|MYK|DEL|MAN|CC|TRI|THR|CCH)-(\d{5})/i) || String(cleanBookingRef).match(/(\d{5})/);
                if (numMatch) {
                    const seqVal = parseInt(numMatch[1], 10);
                    if (seqVal >= 10001) {
                        try {
                            const currentStored = await env.COOLCAT_KV.get('booking_seq');
                            const cur = currentStored ? parseInt(currentStored, 10) : 10000;
                            if (seqVal > cur) {
                                await env.COOLCAT_KV.put('booking_seq', String(seqVal));
                            }
                        } catch (e) {}
                    }
                }
            }
        }

        return new Response(JSON.stringify({ status: 'success', received: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

export async function onRequestOptions() {
    return new Response(null, {
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, x-paystack-signature'
        }
    });
}
