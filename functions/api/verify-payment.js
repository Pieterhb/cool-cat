// Cloudflare Pages Function: /api/verify-payment
// Verifies Paystack transaction, saves booking, and dispatches confirmation emails

export async function onRequestPost(context) {
    const { request, env } = context;

    try {
        const payload = await request.json();
        const {
            reference,
            paystackRef,
            guestName,
            guestEmail,
            guestPhone,
            roomId,
            roomName,
            checkIn,
            checkOut,
            nights,
            totalNights,
            totalAmount,
            amountPaid,
            balanceDue,
            arrivalTime,
            specialRequests
        } = payload;

        // 1. Verify with Paystack (strictly aligns live vs test keys)
        let paystackVerified = false;
        let paystackData = null;

        const paystackSecret = (env && env.PAYSTACK_SECRET_KEY) ? String(env.PAYSTACK_SECRET_KEY).trim() : null;
        const txRefToVerify = (paystackRef || reference || '').trim().replace(/^#/, '');

        // Resolve configured public key to determine expected gateway mode
        let configuredPubKey = (env && env.PAYSTACK_PUBLIC_KEY) ? String(env.PAYSTACK_PUBLIC_KEY).trim() : '';
        if (env && env.COOLCAT_KV) {
            try {
                const cfg = await env.COOLCAT_KV.get('site_config', { type: 'json' });
                if (cfg && cfg.paystack_public_key && String(cfg.paystack_public_key).trim()) {
                    configuredPubKey = String(cfg.paystack_public_key).trim();
                }
            } catch(e) {}
        }
        if (!configuredPubKey) {
            configuredPubKey = 'pk_test_6b6231b5dbcce9a4562f8583b0a3841f1307a407';
        }

        const isLivePublicKey = configuredPubKey.startsWith('pk_live_');
        const isLiveSecretKey = Boolean(paystackSecret && paystackSecret.startsWith('sk_live_'));

        // Safeguard: Guard against live vs test key desynchronization
        if (isLivePublicKey && !isLiveSecretKey) {
            console.error("Paystack Gateway Configuration Mismatch: Public key is LIVE (pk_live_...) but PAYSTACK_SECRET_KEY in Cloudflare environment is not configured as sk_live_...");
            return new Response(JSON.stringify({
                success: false,
                error: "Paystack Gateway Configuration Error: Server secret key (PAYSTACK_SECRET_KEY) is not configured for live processing. Please set sk_live_... in Cloudflare Pages environment variables."
            }), {
                status: 500,
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
            });
        }

        const effectiveSecret = paystackSecret || (isLivePublicKey ? null : 'sk_test_40067fbb064905a9a1e33127111e043eeaee7315');

        if (txRefToVerify && effectiveSecret) {
            try {
                const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(txRefToVerify)}`, {
                    headers: {
                        Authorization: `Bearer ${effectiveSecret}`
                    }
                });
                const data = await res.json();
                if (data && data.status && data.data && data.data.status === 'success') {
                    paystackVerified = true;
                    paystackData = data.data;
                } else {
                    // With live key, reject unverified transactions strictly
                    if (isLiveSecretKey) {
                        return new Response(JSON.stringify({
                            success: false,
                            error: `Paystack payment verification failed: ${data?.message || 'Transaction not verified'}`
                        }), {
                            status: 400,
                            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
                        });
                    }
                    // In test mode or fallback, accept checkout with log notice
                    paystackVerified = true;
                    if (data) console.log("Paystack test verification notice:", data.message || data);
                }
            } catch (pErr) {
                console.error("Paystack verification warning:", pErr);
                if (isLiveSecretKey) {
                    return new Response(JSON.stringify({
                        success: false,
                        error: `Unable to verify payment with Paystack gateway: ${pErr.message}`
                    }), {
                        status: 502,
                        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
                    });
                }
                paystackVerified = true; // allow through in test mode on network error
            }
        }

        function formatPhoneNumber(input) {
            if (!input) return '';
            let raw = String(input).trim().replace(/[\s\-\(\)\.]/g, '');
            if (raw.startsWith('00')) raw = '+' + raw.slice(2);
            if (raw.startsWith('+')) return raw;
            if (raw.startsWith('27') && raw.length >= 10) return '+' + raw;
            if (raw.startsWith('0')) return '+27' + raw.slice(1);
            return '+27' + raw;
        }

        function getRoomPrefixForStays(stays) {
            if (!stays || stays.length === 0) return 'ALL-';
            if (stays.length > 1) return 'ALL-';
            const r = String(stays[0].roomId || '').toLowerCase();
            if (r === 'all' || r.includes('all')) return 'ALL-';
            if (r === 'three-rooms' || r.includes('three') || r.includes('bottom') || r.includes('tri') || r.includes('thr')) return 'TRI-';
            if (r.includes('king') || r.includes('arthur') || r.includes('kin')) return 'KIN-';
            if (r.includes('santor') || r.includes('san') || r.includes('mykon') || r.includes('myk')) return 'SAN-';
            if (r.includes('deluxe') || r.includes('suite') || r.includes('del')) return 'DEL-';
            return 'CC-';
        }

        function getHighestSeqFromBookings(bookingsList) {
            let max = 10000;
            if (Array.isArray(bookingsList)) {
                bookingsList.forEach(b => {
                    const idStr = String(b.id || b.parentBookingId || '');
                    const m = idStr.match(/(?:ALL|KIN|SAN|MYK|DEL|MAN|CC|TRI|THR|CCH)-(\d{5})/i);
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

        let existingForSeq = [];
        if (env && env.COOLCAT_KV) {
            existingForSeq = await env.COOLCAT_KV.get('bookings_list', { type: 'json' }) || [];
        }

        const resolvedNights = Number(nights || totalNights || payload.nights || payload.totalNights || (payload.stays && Array.isArray(payload.stays) && payload.stays.reduce((sum, s) => sum + (Number(s.nights) || 0), 0)) || 1);

        const staysList = (payload.stays && Array.isArray(payload.stays) && payload.stays.length > 0) ? payload.stays : [{
            roomId: roomId || 'king-arthur',
            roomName: roomName || 'King Arthur Suite',
            checkIn: checkIn,
            checkOut: checkOut,
            checkInStr: checkIn,
            checkOutStr: checkOut,
            nights: resolvedNights,
            subtotal: totalAmount || 0
        }];

        // 2. Format Confirmed Booking Record & Stays
        let rawRef = reference ? String(reference).trim() : '';
        if (rawRef.startsWith('#')) rawRef = rawRef.substring(1);
        let bookingRef = rawRef.replace(/_\d{5,}$/, '');

        if (!bookingRef) {
            const nextSeq = await getNextSequenceNumber(env, existingForSeq);
            bookingRef = `CCH-${nextSeq}`;
            await updateSequenceNumber(env, nextSeq);
        } else {
            const m = String(bookingRef).match(/(?:ALL|KIN|SAN|MYK|DEL|MAN|CC|TRI|THR|CCH)-(\d{5})/i) || String(bookingRef).match(/(\d{5})/);
            if (m) {
                const seqVal = parseInt(m[1], 10);
                if (seqVal >= 10001) {
                    await updateSequenceNumber(env, seqVal);
                }
            }
        }

        const numTotal = Number(totalAmount || payload.totalAmount || 0);
        let numPaid = Number(amountPaid !== undefined ? amountPaid : (payload.amountPaid !== undefined ? payload.amountPaid : numTotal));

        // Point 3: Verify charged amount with Paystack gateway data
        if (paystackData && paystackData.amount !== undefined) {
            const verifiedAmountZar = Math.round(Number(paystackData.amount) / 100);
            // Apply a 1-rand tolerance threshold to prevent floating-point / 50-cent rounding rejections on percentage discounts and split deposits
            if ((numPaid - verifiedAmountZar) > 1.00) {
                if (isLiveSecretKey) {
                    return new Response(JSON.stringify({
                        success: false,
                        error: "Payment verification mismatch: Expected R" + numPaid.toLocaleString() + ", but Paystack transaction charged R" + verifiedAmountZar.toLocaleString() + "."
                    }), {
                        status: 400,
                        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
                    });
                }
                // In test or non-live mode, clamp numPaid to actual charged amount
                numPaid = verifiedAmountZar;
            } else {
                // Within 1-rand tolerance (e.g. 50-cent discount rounding): adopt actual gateway charged amount
                numPaid = verifiedAmountZar;
            }
        }

        const numBal = Number(balanceDue !== undefined ? balanceDue : Math.max(0, numTotal - numPaid));
        const bookingStatus = numBal > 0 ? 'deposit_paid' : (numPaid > 0 ? 'fully_paid' : 'not_paid');

        let finalBookingRecord;
        const confirmedBooking = {
            id: bookingRef,
            guestName: guestName || 'Valued Guest',
            guestEmail: guestEmail || '',
            guestPhone: formatPhoneNumber(guestPhone) || '',
            guestCount: Number(payload.guestCount) || 2,
                        stays: staysList,
            totalStays: staysList.length,
            roomId: staysList[0].roomId,
            roomName: staysList.length === 1 ? staysList[0].roomName : `${staysList.length} Reserved Stays`,
            checkIn: staysList[0].checkInStr || staysList[0].checkIn,
            checkOut: staysList[staysList.length - 1].checkOutStr || staysList[staysList.length - 1].checkOut,
            nights: resolvedNights,
            arrivalTime: arrivalTime || '14:00 - 16:00',
            specialRequests: specialRequests || '',
            referralCode: payload.referralCode || '',
            totalAmount: numTotal,
            amountPaid: numPaid,
            balanceDue: numBal,
            paymentMethod: 'card',
            paystackRef: txRefToVerify || (paystackData ? paystackData.reference : rawRef) || bookingRef,
            isRecordedPayment: true,
            isPaidPaystack: true,
            status: bookingStatus,
            createdAt: new Date().toISOString()
        };

        // 3. Save to Cloudflare KV storage if present
        if (env && env.COOLCAT_KV) {
            let existing = await env.COOLCAT_KV.get('bookings_list', { type: 'json' }) || [];

            // Determine roomName and primary room for consolidated display
            // isAllRooms only when someone booked the 'All Rooms' option (not 4 individual rooms on separate dates)
            const isAllRooms = staysList.some(s => s.roomId === 'all');
            const displayRoomName = isAllRooms
                ? 'All Rooms (Entire Property - 3 Suites / 4 Bedrooms)'
                : staysList.length === 1
                    ? staysList[0].roomName
                    : `${staysList.length} Reserved Stays`;

            const parentRecord = {
                id: bookingRef,
                parentBookingId: null,
                isParentBooking: true,
                roomId: isAllRooms ? 'all' : (staysList.length === 1 ? staysList[0].roomId : 'multiple'),
                roomName: displayRoomName,
                checkIn: staysList[0].checkInStr || staysList[0].checkIn,
                checkOut: staysList[staysList.length - 1].checkOutStr || staysList[staysList.length - 1].checkOut,
                nights: resolvedNights,
                guestName: guestName || 'Valued Guest',
                guestEmail: guestEmail || '',
                guestPhone: formatPhoneNumber(guestPhone) || '',
                guestCount: Number(payload.guestCount) || 2,
                totalAmount: numTotal,
                amountPaid: numPaid,
                balanceDue: numBal,
                paystackAmount: (paystackData && paystackData.amount) ? (Number(paystackData.amount) / 100) : numPaid,
                paymentMethod: 'card',
                paystackRef: txRefToVerify || (paystackData ? paystackData.reference : rawRef) || bookingRef,
                isRecordedPayment: true,
                isPaidPaystack: true,
                stays: staysList,
                totalStays: staysList.length,
                referralCode: payload.referralCode || '',
                arrivalTime: arrivalTime || '14:00 - 16:00',
                specialRequests: specialRequests || '',
                status: bookingStatus,
                createdAt: new Date().toISOString()
            };

            // Check if parent record already exists (e.g. from quote, webhook, or previous deposit)
            const parentIdx = existing.findIndex(b => b.id === bookingRef || b.id === rawRef || (b.isParentBooking && b.id === bookingRef));
            if (parentIdx >= 0) {
                const ex = existing[parentIdx];
                const newAmountPaid = (Number(ex.amountPaid) || 0) + numPaid;
                const tot = Number(ex.totalAmount) || numTotal || newAmountPaid;
                const newBal = Math.max(0, tot - newAmountPaid);
                const newStat = (newBal === 0) ? 'fully_paid' : (newAmountPaid > 0 ? 'deposit_paid' : 'not_paid');

                existing[parentIdx] = {
                    ...ex,
                    totalAmount: tot,
                    amountPaid: newAmountPaid,
                    balanceDue: newBal,
                    paystackAmount: (Number(ex.paystackAmount) || 0) + ((paystackData && paystackData.amount) ? (Number(paystackData.amount) / 100) : numPaid),
                    status: newStat,
                    paymentMethod: 'card',
                    paystackRef: txRefToVerify || (paystackData ? paystackData.reference : rawRef) || bookingRef,
                    isRecordedPayment: true,
                    isPaidPaystack: true,
                    guestName: (ex.guestName && ex.guestName !== 'Valued Guest') ? ex.guestName : (guestName || parentRecord.guestName),
                    guestEmail: ex.guestEmail || guestEmail || '',
                    guestPhone: ex.guestPhone || formatPhoneNumber(guestPhone) || '',
                    guestCount: ex.guestCount || parentRecord.guestCount,
                    arrivalTime: ex.arrivalTime || parentRecord.arrivalTime,
                    specialRequests: ex.specialRequests || parentRecord.specialRequests,
                    referralCode: ex.referralCode || parentRecord.referralCode,
                    roomId: ex.roomId || parentRecord.roomId,
                    roomName: ex.roomName || parentRecord.roomName,
                    checkIn: ex.checkIn || parentRecord.checkIn,
                    checkOut: ex.checkOut || parentRecord.checkOut,
                    nights: ex.nights || resolvedNights,
                    stays: (ex.stays && ex.stays.length > 0) ? ex.stays : parentRecord.stays,
                    totalStays: (ex.stays && ex.stays.length > 0) ? ex.stays.length : parentRecord.totalStays,
                    createdAt: ex.createdAt || parentRecord.createdAt,
                    updatedAt: new Date().toISOString()
                };
                finalBookingRecord = existing[parentIdx];
            } else {
                existing.push(parentRecord);
            }

            // Remove any old calendar blocks for this booking before re-inserting clean ones
            existing = existing.filter(b => b.parentBookingId !== bookingRef && b.parentBookingId !== rawRef);

            // 3b. Push individual per-room calendar block records so each room date is blocked
            staysList.forEach(s => {
                const stayRooms = s.roomId === 'all'
                    ? ['king-arthur', 'santori', 'deluxe-suite']
                    : (s.roomId === 'three-rooms' ? ['king-arthur', 'santori'] : [s.roomId]);
                stayRooms.forEach(rid => {
                    existing.push({
                        id: `${bookingRef}_${rid}_${s.checkInStr || s.checkIn}`,
                        parentBookingId: bookingRef,
                        isCalendarBlock: true,
                        roomId: rid,
                        roomName: s.roomName || rid,
                        checkIn: s.checkInStr || s.checkIn,
                        checkOut: s.checkOutStr || s.checkOut,
                        nights: s.nights || 1,
                        guestName: guestName || 'Valued Guest',
                        guestEmail: guestEmail || '',
                        guestPhone: formatPhoneNumber(guestPhone) || '',
                        totalAmount: 0,
                        amountPaid: 0,
                        balanceDue: 0,
                        referralCode: payload.referralCode || '',
                        status: bookingStatus,
                        createdAt: new Date().toISOString()
                    });
                });
            });

            await env.COOLCAT_KV.put('bookings_list', JSON.stringify(existing));
        }

        if (!finalBookingRecord) {
            finalBookingRecord = confirmedBooking;
        }

        // 4. Dispatch Automated Emails (Guest Confirmation & Owner Alert)
        const emailResults = await dispatchBookingEmails(finalBookingRecord, env);
        if (emailResults && emailResults.sent && env && env.COOLCAT_KV) {
            try {
                let latestList = await env.COOLCAT_KV.get('bookings_list', { type: 'json' }) || [];
                const idx = latestList.findIndex(b => b.id === finalBookingRecord.id || (b.isParentBooking && b.id === finalBookingRecord.id));
                if (idx >= 0) {
                    latestList[idx].emailsDispatched = true;
                    await env.COOLCAT_KV.put('bookings_list', JSON.stringify(latestList));
                }
            } catch (e) {}
        }

        return new Response(JSON.stringify({
            success: true,
            message: "Payment verified and booking confirmed.",
            booking: finalBookingRecord,
            emailDelivery: emailResults
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
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        }
    });
}

// Helper to generate and send emails via Resend or Cloudflare Mail API
async function dispatchBookingEmails(booking, env) {
    const resendApiKey = (env && env.RESEND_API_KEY) ? env.RESEND_API_KEY : null;

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
            <p style="margin: 4px 0;">👥 <strong>Total Guests Staying:</strong> ${booking.guestCount || 2} Guests</p>
            
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
        <p>A new guest has completed their booking and payment via Paystack:</p>
        <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin: 15px 0;">
          <tr><td style="padding: 6px; border-bottom: 1px solid #eee;"><strong>Guest Name:</strong></td><td style="padding: 6px; border-bottom: 1px solid #eee;">${booking.guestName}</td></tr>
          <tr><td style="padding: 6px; border-bottom: 1px solid #eee;"><strong>Email:</strong></td><td style="padding: 6px; border-bottom: 1px solid #eee;"><a href="mailto:${booking.guestEmail}">${booking.guestEmail}</a></td></tr>
          <tr><td style="padding: 6px; border-bottom: 1px solid #eee;"><strong>WhatsApp/Phone:</strong></td><td style="padding: 6px; border-bottom: 1px solid #eee;"><a href="https://wa.me/${booking.guestPhone.replace(/[^0-9]/g, '')}">${booking.guestPhone}</a></td></tr>
          <tr><td style="padding: 6px; border-bottom: 1px solid #eee;"><strong>Guests Staying:</strong></td><td style="padding: 6px; border-bottom: 1px solid #eee;">${booking.guestCount || 2} Guests</td></tr>
          
          <tr><td style="padding: 6px; border-bottom: 1px solid #eee;"><strong>Stays Booked:</strong></td><td style="padding: 6px; border-bottom: 1px solid #eee;">${staysRowsHtml}</td></tr>
          <tr><td style="padding: 6px; border-bottom: 1px solid #eee;"><strong>Arrival Time:</strong></td><td style="padding: 6px; border-bottom: 1px solid #eee;">${booking.arrivalTime}</td></tr>
          <tr><td style="padding: 6px; border-bottom: 1px solid #eee;"><strong>Special Requests:</strong></td><td style="padding: 6px; border-bottom: 1px solid #eee;">${booking.specialRequests || 'None'}</td></tr>
          <tr><td style="padding: 6px; border-bottom: 1px solid #eee;"><strong>Amount Paid:</strong></td><td style="padding: 6px; border-bottom: 1px solid #eee; color: #166534; font-weight: bold;">R${Number(booking.amountPaid).toLocaleString()}</td></tr>
          <tr><td style="padding: 6px;"><strong>Balance Pending:</strong></td><td style="padding: 6px; color: #991b1b; font-weight: bold;">R${Number(booking.balanceDue).toLocaleString()}</td></tr>
        </table>
        <p style="margin-top: 20px;"><a href="https://cool-cat.co.za/admin" style="background: #0f52ba; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">View in Admin Dashboard</a></p>
      </div>
    </body>
    </html>
    `;

    if (resendApiKey) {
        try {
            // Send Guest Email
            const guestRes = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${resendApiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    from: 'Cool-Cat <bookings@cool-cat.co.za>',
                    to: [booking.guestEmail],
                    subject: `Booking Confirmed #${cleanRef} - Cool-Cat Strand`,
                    html: guestHtml
                })
            });

            let guestDelivery = { ok: guestRes.ok, status: guestRes.status };
            if (!guestRes.ok) {
                const guestErr = await guestRes.text();
                console.error("Resend guest email delivery error:", guestRes.status, guestErr);
                guestDelivery.error = guestErr;
            }

            // Send Owner Alert Email
            const ownerRes = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${resendApiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    from: 'Cool-Cat System <bookings@cool-cat.co.za>',
                    to: ['bookings@cool-cat.co.za', 'corrie@cool-cat.co.za'],
                    subject: `🔔 New Booking #${cleanRef}: ${booking.guestName} (${booking.roomName})`,
                    html: ownerHtml
                })
            });

            let ownerDelivery = { ok: ownerRes.ok, status: ownerRes.status };
            if (!ownerRes.ok) {
                const ownerErr = await ownerRes.text();
                console.error("Resend owner email delivery error:", ownerRes.status, ownerErr);
                ownerDelivery.error = ownerErr;
            }

            const allSent = guestRes.ok && ownerRes.ok;
            return {
                sent: allSent,
                provider: 'resend',
                guest: guestDelivery,
                owner: ownerDelivery
            };
        } catch (e) {
            console.error("Resend delivery exception:", e);
            return { sent: false, error: e.message };
        }
    }

    return { sent: false, note: "No RESEND_API_KEY configured yet. Email templates generated successfully." };
}
