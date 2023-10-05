# Smart Scheduler

This node has been written to address the need to better control inhouse heating system with a visual scheduler in node-red.
It have been more than inspired by the excellent work of node-red-contrib-light-scheduler.

It enables to defines heating zone with temperature setPoint and to apply this to a weekly schedule.

The Smartscheduler is interface with Home assistant and use MQTT to advertise and send update.

WORK IN PROGRESS, please report any issues and I will try to fixe them

## Key features:

- Interface with Home Assistant (adversise, and update),
- Heating zone definition with color
- Visual weekly calendar
- Manual Override mode with duration
- On / Off / Auto mode
- different output modes (state-change, state-change+startup, every minute)
- External manual trigger
- Default setPoint






