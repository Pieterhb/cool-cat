// Cloudflare Pages Function: /api/paystack-webhook
// Handles server-to-server Paystack webhooks (e.g. charge.success) with crypto verification

export async function onRequestPost(context) {
    const { request, env } = context;

    try {
        const bodyText = await request.text();
        const signature = request.headers.get('x-paystack-signature');
        const paystackSecret = (env && env.PAYSTACK_SECRET_KEY) ? env.PAYSTACK_SECRET_KEY : '';

        // Verify HMAC SHA512 signature if secret key is configured
        if (paystackSecret && signature) {
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
                signature.match(/.{1,2}/g).map(byte => parseInt(byte, 16))
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
            const data = event.data;
            const ref = data.reference;
            const amountInZar = data.amount / 100;
            const customerEmail = data.customer ? data.customer.email : '';
            const metadata = data.metadata || {};

            console.log(`Paystack Webhook Success: Ref ${ref} | R${amountInZar} | Customer: ${customerEmail}`);

            // Save confirmed booking to KV if available
            if (env && env.COOLCAT_KV) {
                let existing = await env.COOLCAT_KV.get('bookings_list', { type: 'json' }) || [];
                const foundIndex = existing.findIndex(b => b.id === ref);
                if (foundIndex >= 0) {
                    existing[foundIndex].status = 'confirmed';
                    existing[foundIndex].amountPaid = amountInZar;
                } else {
                    existing.push({
                        id: ref,
                        roomId: metadata.room_id || 'king-arthur',
                        roomName: metadata.room || 'King Arthur Room',
                        checkIn: metadata.check_in || '',
                        checkOut: metadata.check_out || '',
                        guestName: metadata.guest_name || 'Guest',
                        guestEmail: customerEmail,
                        guestPhone: metadata.phone || '',
                        totalAmount: amountInZar,
                        amountPaid: amountInZar,
                        balanceDue: 0,
                        status: 'confirmed',
                        createdAt: new Date().toISOString()
                    });
                }
                await env.COOLCAT_KV.put('bookings_list', JSON.stringify(existing));
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
