// Cloudflare Pages Function: /api/ical
// Generates standard RFC 5545 iCal (.ics) calendar feed for Airbnb, Booking.com, and Google Calendar sync

export async function onRequestGet(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const requestedRoom = url.searchParams.get('room') || 'all';

    const defaultBookings = [
        { id: 'SEED-101', roomId: 'king-arthur', roomName: 'King Arthur Room', checkIn: '2026-08-28', checkOut: '2026-08-31', status: 'confirmed' },
        { id: 'SEED-102', roomId: 'santori', roomName: 'Santori Room', checkIn: '2026-08-29', checkOut: '2026-09-02', status: 'confirmed' },
        { id: 'SEED-103', roomId: 'mykonos', roomName: 'Mykonos Room', checkIn: '2026-08-29', checkOut: '2026-09-01', status: 'confirmed' },
        { id: 'SEED-104', roomId: 'deluxe-suite', roomName: 'Cool-Cat Deluxe Suite', checkIn: '2026-08-29', checkOut: '2026-08-31', status: 'confirmed' },
        { id: 'SEED-105', roomId: 'king-arthur', roomName: 'King Arthur Room', checkIn: '2026-09-11', checkOut: '2026-09-14', status: 'confirmed' },
        { id: 'SEED-106', roomId: 'santori', roomName: 'Santori Room', checkIn: '2026-09-18', checkOut: '2026-09-22', status: 'confirmed' },
        { id: 'SEED-107', roomId: 'mykonos', roomName: 'Mykonos Room', checkIn: '2026-09-18', checkOut: '2026-09-21', status: 'confirmed' },
        { id: 'SEED-108', roomId: 'deluxe-suite', roomName: 'Cool-Cat Deluxe Suite', checkIn: '2026-09-24', checkOut: '2026-09-28', status: 'confirmed' },
        { id: 'SEED-109', roomId: 'king-arthur', roomName: 'King Arthur Room', checkIn: '2026-12-23', checkOut: '2026-12-28', status: 'confirmed' },
        { id: 'SEED-110', roomId: 'santori', roomName: 'Santori Room', checkIn: '2026-12-24', checkOut: '2026-12-29', status: 'confirmed' },
        { id: 'SEED-111', roomId: 'mykonos', roomName: 'Mykonos Room', checkIn: '2026-12-24', checkOut: '2026-12-28', status: 'confirmed' },
        { id: 'SEED-112', roomId: 'deluxe-suite', roomName: 'Cool-Cat Deluxe Suite', checkIn: '2026-12-22', checkOut: '2026-12-27', status: 'confirmed' }
    ];

    try {
        let storedBookings = [];
        if (env && env.COOLCAT_KV) {
            const data = await env.COOLCAT_KV.get('bookings_list', { type: 'json' });
            if (data && Array.isArray(data)) {
                storedBookings = data;
            }
        }

        const bookings = [...defaultBookings, ...storedBookings];

        // Filter bookings for the requested room
        const activeBookings = bookings.filter(b => {
            if (b.status === 'cancelled') return false;
            if (requestedRoom === 'all') return true;
            return b.roomId === requestedRoom || b.roomId === 'all';
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
                ics.push(`SUMMARY:Reserved (${b.roomName || b.roomId || 'Cool-Cat Room'})`);
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
