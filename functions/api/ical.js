// Cloudflare Pages Function: /api/ical
// Generates standard RFC 5545 iCal (.ics) calendar feed for Airbnb, Booking.com, and Google Calendar sync

export async function onRequestGet(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const requestedRoom = url.searchParams.get('room') || 'all';

    try {
        let bookings = [];
        if (env && env.COOLCAT_KV) {
            bookings = await env.COOLCAT_KV.get('bookings_list', { type: 'json' }) || [];
        }

        // Filter bookings for the requested room
        const activeBookings = bookings.filter(b => {
            if (b.status === 'cancelled') return false;
            if (requestedRoom === 'all') return true;
            return b.roomId === requestedRoom;
        });

        // Format dates into iCal YYYYMMDD format
        function formatIcalDate(dateStr) {
            if (!dateStr) return '';
            return dateStr.replace(/[^0-9]/g, '');
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

        activeBookings.forEach((b, idx) => {
            const dtStart = formatIcalDate(b.checkIn);
            const dtEnd = formatIcalDate(b.checkOut);
            const uid = `booking-${b.id || idx}@cool-cat.co.za`;

            if (dtStart && dtEnd) {
                ics.push('BEGIN:VEVENT');
                ics.push(`UID:${uid}`);
                ics.push(`DTSTAMP:${now}`);
                ics.push(`DTSTART;VALUE=DATE:${dtStart}`);
                ics.push(`DTEND;VALUE=DATE:${dtEnd}`);
                ics.push(`SUMMARY:Reserved (${b.roomName || b.roomId || 'Cool Cat Room'})`);
                ics.push(`DESCRIPTION:Booking Ref #${b.id || idx} - Cool-Cat`);
                ics.push('STATUS:CONFIRMED');
                ics.push('END:VEVENT');
            }
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
