// Cloudflare Pages Function: /api/paystack-webhook
// Handles server-to-server Paystack webhooks (e.g. charge.success) with crypto verification

export async function onRequestPost(context) {
    const { request, env } = context;

    try {
        const bodyText = await request.text();
        const signature = request.headers.get('x-paystack-signature');
        const paystackSecret = (env && env.PAYSTACK_SECRET_KEY) ? String(env.PAYSTACK_SECRET_KEY).trim() : null;

        let configuredPubKey = (env && env.PAYSTACK_PUBLIC_KEY) ? String(env.PAYSTACK_PUBLIC_KEY).trim() : '';
        if (env && env.COOLCAT_KV) {
            try {
                const cfg = await env.COOLCAT_KV.get('site_config', { type: 'json' });
                if (cfg && cfg.paystack_public_key && String(cfg.paystack_public_key).trim()) {
                    configuredPubKey = String(cfg.paystack_public_key).trim();
                }
            } catch(e) {}
        }
        const isLivePublicKey = configuredPubKey.startsWith('pk_live_');
        if (isLivePublicKey && (!paystackSecret || !paystackSecret.startsWith('sk_live_'))) {
            return new Response(JSON.stringify({ error: "Paystack live secret key not configured in environment" }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }

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
                ? 'All Rooms (Entire Property - 3 Suites / 4 Bedrooms)'
                : (staysList.length === 1 ? (staysList[0].roomName || 'Single Room') : (staysList.length > 1 ? `${staysList.length} Reserved Stays` : 'All Rooms (Entire Property - 3 Suites / 4 Bedrooms)'));
            const finalRoomName = metadata.room_name || defaultDisplayRoomName;
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
                    paystackAmount: amountInZar,
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
                        paystackAmount: (Number(ex.paystackAmount) || 0) + amountInZar,
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

                // Webhook Email Dispatch Fallback: send confirmation if verify-payment has not already dispatched
                const parentIdxForEmail = existing.findIndex(b => b.id === cleanBookingRef || (b.isParentBooking && b.id === cleanBookingRef));
                if (parentIdxForEmail >= 0 && !existing[parentIdxForEmail].emailsDispatched) {
                    try {
                        const emailRes = await dispatchBookingEmails(existing[parentIdxForEmail], env);
                        if (emailRes && emailRes.sent) {
                            existing[parentIdxForEmail].emailsDispatched = true;
                        }
                    } catch (e) {
                        console.error("Webhook email fallback exception:", e);
                    }
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


// Helper to generate and send emails via Resend when triggered asynchronously by Webhook
async function dispatchBookingEmails(booking, env) {
    const resendApiKey = (env && env.RESEND_API_KEY) ? env.RESEND_API_KEY : null;
    if (!resendApiKey) return { sent: false, note: "No RESEND_API_KEY configured" };

    let wifiNet = (env && env.WIFI_NETWORK) ? env.WIFI_NETWORK : 'Gouws';
    let wifiPass = (env && env.WIFI_PASSWORD) ? env.WIFI_PASSWORD : 'Available upon check-in';
    if (env && env.COOLCAT_KV) {
        try {
            const cfg = await env.COOLCAT_KV.get('site_config', { type: 'json' });
            if (cfg && cfg.wifi_network) wifiNet = cfg.wifi_network;
            if (cfg && cfg.wifi_password) wifiPass = cfg.wifi_password;
        } catch(e) {}
    }

    const cleanRef = (booking.id || '').replace(/^#/, '');
    const staysRowsHtml = (booking.stays && Array.isArray(booking.stays)) ? booking.stays.map(s => `
        <div style="padding: 8px 12px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 6px; margin-bottom: 6px;">
            <strong>🛏️ ${s.roomName}</strong><br>
            <span>📅 ${s.checkInStr || s.checkIn} to ${s.checkOutStr || s.checkOut} (${s.nights} Nights)</span><br>
            <span>Subtotal: R${Number(s.subtotal || 0).toLocaleString()}</span>
        </div>
    `).join('') : `<p>🛏️ ${booking.roomName}: ${booking.checkIn} to ${booking.checkOut}</p>`;

    const guestHtml = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="font-family: Arial, sans-serif; background-color: #f4f7f9; margin: 0; padding: 20px; color: #333;">
      <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.08);">
        <div style="background: linear-gradient(135deg, #0A3A85, #0F52BA); padding: 25px; text-align: center; color: #ffffff;">
          <h1 style="margin: 0; font-size: 24px;">Cool-Cat 🐾</h1>
          <p style="margin: 5px 0 0; font-size: 15px; opacity: 0.9;">Booking Confirmed – Welcome to Strand!</p>
        </div>
        <div style="padding: 25px;">
          <p style="font-size: 16px;">Dear <strong>${booking.guestName}</strong>,</p>
          <p>Thank you for choosing Cool-Cat! Your reservation is officially secured.</p>
          <div style="background: #eef2ff; border: 1px solid #c7d2fe; border-radius: 8px; padding: 15px; margin: 20px 0;">
            <p style="margin: 0 0 10px; font-weight: bold; color: #0a3a85; font-size: 16px;">Booking Reference: #${cleanRef}</p>
            <div style="margin-bottom: 12px;">
                <strong>Reserved Stays:</strong>
                ${staysRowsHtml}
            </div>
            <p style="margin: 4px 0;">💰 <strong>Total Stay:</strong> R${Number(booking.totalAmount).toLocaleString()}</p>
            <p style="margin: 4px 0; color: #166534;">💳 <strong>Amount Paid:</strong> R${Number(booking.amountPaid).toLocaleString()}</p>
            ${booking.balanceDue > 0 ? `<p style="margin: 4px 0; color: #991b1b; font-weight: bold;">⏳ Balance Due at Check-In: R${Number(booking.balanceDue).toLocaleString()}</p>` : `<p style="margin: 4px 0; color: #166534;">🎉 100% Fully Paid</p>`}
          </div>
          <div style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 15px; margin: 20px 0;">
            <h3 style="margin: 0 0 10px; color: #166534; font-size: 16px;">🏠 Check-In & Access Details:</h3>
            <p style="margin: 4px 0;">📶 <strong>Free Wi-Fi:</strong> Network: <code>${wifiNet}</code> | Pass: <code>${wifiPass}</code></p>
            <p style="margin: 4px 0;">📍 <strong>Address:</strong> Cool-Cat, Strand, Western Cape</p>
            <p style="margin: 4px 0;">🗺️ <strong>Directions:</strong> <a href="https://maps.google.com/?q=Cool+Cat+B%26B+Strand" style="color: #0f52ba; font-weight: bold;">Open Google Maps Directions</a></p>
            <p style="margin: 4px 0;">📱 <strong>Host:</strong> Michele Rossouw (072 889 4840)</p>
          </div>
          <div style="font-size: 13px; color: #64748b; margin-top: 25px; border-top: 1px solid #e2e8f0; padding-top: 15px;">
            <p style="margin: 2px 0;"><strong>House Reminders:</strong> Non-smoking inside bedrooms • No pets allowed • Quiet hours 23:00 - 06:00.</p>
            <p style="margin: 2px 0;">Have a question? Reply directly to this email or WhatsApp Michele at 072 889 4840.</p>
          </div>
        </div>
      </div>
    </body>
    </html>
    `;

    const ownerHtml = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="font-family: Arial, sans-serif; background-color: #f4f7f9; padding: 20px; color: #333;">
      <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; padding: 25px; border: 1px solid #e2e8f0;">
        <h2 style="color: #0a3a85; margin-top: 0;">🔔 New Booking Received: #${cleanRef}</h2>
        <p>A new guest payment has been verified via Paystack:</p>
        <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin: 15px 0;">
          <tr><td style="padding: 6px; border-bottom: 1px solid #eee;"><strong>Guest Name:</strong></td><td style="padding: 6px; border-bottom: 1px solid #eee;">${booking.guestName}</td></tr>
          <tr><td style="padding: 6px; border-bottom: 1px solid #eee;"><strong>Email:</strong></td><td style="padding: 6px; border-bottom: 1px solid #eee;">${booking.guestEmail}</td></tr>
          <tr><td style="padding: 6px; border-bottom: 1px solid #eee;"><strong>WhatsApp/Phone:</strong></td><td style="padding: 6px; border-bottom: 1px solid #eee;">${booking.guestPhone}</td></tr>
          <tr><td style="padding: 6px; border-bottom: 1px solid #eee;"><strong>Room Booked:</strong></td><td style="padding: 6px; border-bottom: 1px solid #eee;">${booking.roomName}</td></tr>
          <tr><td style="padding: 6px; border-bottom: 1px solid #eee;"><strong>Amount Paid:</strong></td><td style="padding: 6px; border-bottom: 1px solid #eee; color: #166534; font-weight: bold;">R${Number(booking.amountPaid).toLocaleString()}</td></tr>
          <tr><td style="padding: 6px;"><strong>Balance Pending:</strong></td><td style="padding: 6px; color: #991b1b; font-weight: bold;">R${Number(booking.balanceDue).toLocaleString()}</td></tr>
        </table>
        <p style="margin-top: 20px;"><a href="https://cool-cat.co.za/admin" style="background: #0f52ba; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">View in Admin Dashboard</a></p>
      </div>
    </body>
    </html>
    `;

    try {
        const guestRes = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                from: 'Cool-Cat <bookings@cool-cat.co.za>',
                to: [booking.guestEmail],
                subject: `Booking Confirmed #${cleanRef} - Cool-Cat Strand`,
                html: guestHtml
            })
        });

        const ownerRes = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                from: 'Cool-Cat System <bookings@cool-cat.co.za>',
                to: ['bookings@cool-cat.co.za', 'corrie@cool-cat.co.za'],
                subject: `🔔 New Booking #${cleanRef}: ${booking.guestName} (${booking.roomName})`,
                html: ownerHtml
            })
        });

        return { sent: guestRes.ok && ownerRes.ok, provider: 'resend' };
    } catch (e) {
        console.error("Webhook Resend delivery exception:", e);
        return { sent: false, error: e.message };
    }
}
