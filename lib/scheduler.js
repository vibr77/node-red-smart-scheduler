module.exports = {
  matchSchedule: function(node) {
    
    var events = node.runningEvents || node.events;
    if(!Array.isArray(events)){
      node.warn('Incompatible event configuration!')
      return true;
    }

    var matchingEvent={
      'ruleIdx': -1,
      'eventId': -1
    };

    var now = new Date();
    
    events.forEach((event) => {

      function parseDate(dow,mod) {
       
        dow = parseInt(dow);
        mod = parseInt(mod);

        if(isNaN(dow) || isNaN(mod))
          return null;

        var hours = Math.floor(mod / 60);
        var minutes = mod - (hours*60);

        var year = now.getFullYear();
        var month = now.getMonth();
        var ndow = now.getDay();            
        
        // Event DOW is before "today", move it forward in time
        var etdow = dow < ndow ? ndow + dow + 1 : dow;
        var dayDiff = etdow - ndow;

        var date = now.getDate()+dayDiff;
        return new Date(year, month, date, hours, minutes, 0, 0);
      };
  
      var evtStart = parseDate(event.s_dow,event.s_mod);
      var evtEnd = parseDate(event.e_dow,event.e_mod);      

      if(evtStart == null || evtEnd == null){
        console.log("return -1");
        matchingEvent={
          'ruleIdx': -1,
          'eventId': -1
        };
        return matchingEvent;
      }
        
      // Adjust evtEnd for events stopping at midninght "today"
      if(evtStart.getTime() > evtEnd.getTime()) {  
        evtEnd.setDate(evtEnd.getDate() + 7);
      }

      if(now.getTime() >= evtStart.getTime() && now.getTime() <= evtEnd.getTime()) {
        console.log("Matching Event");
        console.log(event);
       
        matchingEvent={
          'ruleIdx': event.ruleIdx,
          'eventId': event.id
        };
        return matchingEvent;
        
      }
    });

    return matchingEvent;
  } 
}
