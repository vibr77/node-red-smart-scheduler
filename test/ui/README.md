# Editor UI tests

Browser tests for the smart-scheduler editor (and the new smart-valve / smart-boiler fields), run with
Playwright against a real Node-RED.

1. Install Node-RED and the three modules in a test user directory, and use a flow with a
   `smart-scheduler` node `sch1`, a `smart-valve` node `sv1`, a `smart-boiler` node `sb1` and their
   settings nodes `vs1` / `bs1` (see `flows.example.json`).
2. Start Node-RED on http://127.0.0.1:1880 (no admin auth).
3. `pip install playwright && playwright install chromium`
4. `python3 test/ui/ui_tests.py ui-results`

Screenshots and `results.json` are written to the output folder. The tests do not need internet access:
the calendar libraries are served by the module itself.
