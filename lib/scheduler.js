/*
 * Schedule matching.
 *
 * Events are stored by the editor as day-of-week (0 = Sunday … 6 = Saturday, 7 accepted as Sunday)
 * and minute-of-day for their start (s_dow, s_mod) and end (e_dow, e_mod), in local time.
 *
 * 0.82: matching is done on "minute of the week". 0.81 shifted the event day forward when it was
 * before today, so an event running across midnight (Tue 22:00 -> Wed 06:00) or several days
 * (Mon 08:00 -> Fri 18:00) stopped matching after midnight and the room fell back to the default
 * setpoint.
 */
const WEEK = 7 * 1440;

function weekMinute(dow, mod) {
    dow = parseInt(dow);
    mod = parseInt(mod);
    if (isNaN(dow) || isNaN(mod)) return null;
    if (dow === 7) dow = 0;                  // Sunday may be stored as 7
    if (dow < 0 || dow > 6 || mod < 0 || mod > 1440) return null;
    return dow * 1440 + mod;
}

function matchEvents(events, now) {
    const result = { ruleIdx: -1, eventId: -1 };
    if (!Array.isArray(events)) return result;
    now = now || new Date();
    const n = now.getDay() * 1440 + now.getHours() * 60 + now.getMinutes();

    events.forEach((event) => {
        if (!event) return;
        const s = weekMinute(event.s_dow, event.s_mod);
        let e = weekMinute(event.e_dow, event.e_mod);
        if (s === null || e === null) return;
        e = e % WEEK;
        let match;
        if (s === e) match = false;                       // empty event
        else if (s < e) match = n >= s && n <= e;         // same week
        else match = n >= s || n <= e;                    // wraps Saturday -> Sunday
        // As in 0.81, the last matching event wins.
        if (match) { result.ruleIdx = event.ruleIdx; result.eventId = event.id; }
    });
    return result;
}

module.exports = {
    // Accepts a schedule object ({events}) or a node ({runningEvents|events}); `now` is for tests.
    matchSchedule: function (sched, now) {
        if (!sched) return { ruleIdx: -1, eventId: -1 };
        const events = sched.runningEvents || sched.events;
        return matchEvents(events, now);
    },
    weekMinute,
};
