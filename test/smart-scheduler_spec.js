var should = require("should");
var helper = require("node-red-node-test-helper");
var smartSchedulerNode = require("../smart-scheduler.js");
var smartSchedulerSettingsNode = require("../smart-scheduler-settings.js");

helper.init(require.resolve('node-red'));

describe('smart-scheduler Node', function () {

  beforeEach(function (done) {
      helper.startServer(done);
  });

  afterEach(function (done) {
      helper.unload();
      helper.stopServer(done);
  });

  it('should be loaded', function (done) {
    var flow = [{ id: "n1", type: "smart-scheduler", name: "test-scheduler" }];
    helper.load(smartSchedulerNode, flow, function () {
      var n1 = helper.getNode("n1");
      try {
        n1.should.have.property('name', 'test-scheduler');
        done();
      } catch(err) {
        done(err);
      }
    });
  });

  it('should handle auto command', function (done) {
    var flow = [
      { id: "n1", type: "smart-scheduler", name: "test-scheduler", wires:[["n2"]], schedules:"[]" },
      { id: "n2", type: "helper" }
    ];
    helper.load(smartSchedulerNode, flow, function () {
      var n1 = helper.getNode("n1");
      
      n1.receive({ payload: { command: "auto" } });
      
      setTimeout(function() {
          // Check internal state if possible, or just ensure no crash
          try {
             // n1.executionMode.should.equal("auto"); // executionMode is internal, might not be accessible directly on the node object wrapper depending on helper implementation
             // But usually helper.getNode returns the node instance.
             n1.should.have.property('executionMode', 'auto');
             done();
          } catch(e) {
              done(e);
          }
      }, 100);
    });
  });
});
