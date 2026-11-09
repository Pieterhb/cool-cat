// Cloudflare Pages Function: /api/ical
// Generates standard RFC 5545 iCal (.ics) calendar feed for Airbnb, Booking.com, and Google Calendar sync

export async function onRequestGet(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const requestedRoom = url.searchParams.get('room') || 'all';

    // Initial bookings (empty by default; populated via live bookings & admin in Cloudflare KV)
    const defaultBookings = [];

    try {
        let storedBookings = [];
        if (env && env.COOLCAT_KV) {
            const data = await env.COOLCAT_KV.get('bookings_list', { type: 'json' });
            if (data && Array.isArray(data)) {
                storedBookings = data;
            }
        }

        const bookings = [...defaultBookings, ...storedBookings];

        // Point 4: Deduplicate and filter bookings cleanly without duplicate VEVENTs
        const uncancelled = bookings.filter(b => b.status !== 'cancelled' && b.checkIn && b.checkOut);

        let activeBookings = [];
        if (requestedRoom === 'all') {
            // For the entire property calendar:
            // Multi-stay bookings (different rooms or non-contiguous dates) have a parent booking spanning
            // the full range from earliest check-in to latest check-out. To avoid over-blocking unoccupied
            // gap days on external platforms, export the individual stay records or child blocks instead of the outer span.
            const multiStayParentIds = new Set(
                uncancelled
                    .filter(b => !b.isCalendarBlock && (b.totalStays > 1 || b.roomId === 'multiple' || (Array.isArray(b.stays) && b.stays.length > 1)))
                    .map(b => b.id)
            );

            const multiStayChildBlocks = uncancelled.filter(b => b.isCalendarBlock && multiStayParentIds.has(b.parentBookingId));
            const multiStayParentsWithChildren = new Set(multiStayChildBlocks.map(b => b.parentBookingId));
            const allParentIds = new Set(uncancelled.filter(b => !b.isCalendarBlock).map(b => b.id));

            uncancelled.forEach(b => {
                if (!b.isCalendarBlock) {
                    if (multiStayParentIds.has(b.id)) {
                        // If multi-stay parent has no child calendar blocks in KV, expand b.stays array
                        if (!multiStayParentsWithChildren.has(b.id) && Array.isArray(b.stays) && b.stays.length > 0) {
                            b.stays.forEach((s, sIdx) => {
                                const cIn = s.checkInStr || s.checkIn;
                                const cOut = s.checkOutStr || s.checkOut;
                                if (cIn && cOut) {
                                    activeBookings.push({
                                        id: `${b.id}_${sIdx + 1}`,
                                        roomId: s.roomId || b.roomId,
                                        roomName: s.roomName || b.roomName,
                                        checkIn: cIn,
                                        checkOut: cOut,
                                        status: b.status
                                    });
                                }
                            });
                        }
                    } else {
                        activeBookings.push(b);
                    }
                } else {
                    // Include child blocks for multi-stay bookings, or orphaned blocks with no parent in DB
                    if (multiStayParentIds.has(b.parentBookingId) || !allParentIds.has(b.parentBookingId)) {
                        activeBookings.push(b);
                    }
                }
            });
        } else {
            // For a specific room (e.g. king-arthur, santori, deluxe-suite):
            // Check which parent bookings already have a dedicated calendar block for this room
            const childParentIds = new Set(
                uncancelled.filter(b => b.roomId === requestedRoom && b.isCalendarBlock).map(b => b.parentBookingId).filter(Boolean)
            );

            activeBookings = uncancelled.filter(b => {
                // If this is a parent booking and a dedicated calendar block exists for it, exclude parent to prevent duplicate VEVENT
                if (!b.isCalendarBlock && childParentIds.has(b.id)) return false;
                // Direct calendar block or standalone booking for this room
                if (b.roomId === requestedRoom) return true;
                // If it's a booking for 'all' rooms that doesn't have a separate child block for this room
                if (b.roomId === 'all' && !b.isCalendarBlock && !childParentIds.has(b.id)) return true;
                // If it's a booking for 'three-rooms' (King Arthur & Santori) that doesn't have a child block for this room
                if (b.roomId === 'three-rooms' && !b.isCalendarBlock && ['king-arthur', 'santori'].includes(requestedRoom) && !childParentIds.has(b.id)) return true;
                return false;
            });
        }

        // Format dates into standard RFC 5545 YYYYMMDD format (8 digits)
        function formatIcalDate(dateStr) {
            if (!dateStr) return '';
            const clean = String(dateStr).trim().slice(0, 10).replace(/[^0-9]/g, '');
            return clean.length === 8 ? clean : '';
        }

        const now = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

        let ics = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//Cool-Cat//Calendar Sync 1.0//EN',
            'CALSCALE:GREGORIAN',
            'METHOD:PUBLISH',
            `X-WR-CALNAME:Cool-Cat - ${requestedRoom.toUpperCase()}`
        ];

        const seenEvents = new Set();
        activeBookings.forEach((b, idx) => {
            const dtStart = formatIcalDate(b.checkIn);
            const dtEnd = formatIcalDate(b.checkOut);
            if (!dtStart || !dtEnd) return;

            const roomKey = b.roomId || requestedRoom;
            const eventKey = `${roomKey}_${dtStart}_${dtEnd}`;
            if (seenEvents.has(eventKey)) return;
            seenEvents.add(eventKey);

            const uid = `booking-${b.id || idx}@cool-cat.co.za`;

            ics.push('BEGIN:VEVENT');
            ics.push(`UID:${uid}`);
            ics.push(`DTSTAMP:${now}`);
            ics.push(`DTSTART;VALUE=DATE:${dtStart}`);
            ics.push(`DTEND;VALUE=DATE:${dtEnd}`);
            ics.push(`SUMMARY:Reserved (${b.roomName || b.roomId || 'Cool-Cat Room'})`);
            ics.push(`DESCRIPTION:Booking Ref #${b.id || idx} - Cool-Cat`);
            ics.push('STATUS:CONFIRMED');
            ics.push('END:VEVENT');
        });

        ics.push('END:VCALENDAR');

        return new Response(ics.join('\r\n'), {
            status: 200,
            headers: {
                'Content-Type': 'text/calendar; charset=utf-8',
                'Content-Disposition': `attachment; filename="coolcat-${requestedRoom}.ics"`,
                'Cache-Control': 'no-cache, no-store, must-revalidate'
            }
        });

    } catch (err) {
        return new Response(`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Cool-Cat//EN\r\nEND:VCALENDAR`, {
            status: 200,
            headers: { 'Content-Type': 'text/calendar; charset=utf-8' }
        });
    }
}
