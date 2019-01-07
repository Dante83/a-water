//
//Frame Tracker allows us to get an idea for the time between frames
//so our particles can predict what kind of time frames they are trying
//to predict.
//
AFRAME.registerComponent('frame-tracker', {
  schema: {
    'maxDataCount': {type: 'number', default: 900},
    'chunkLength': {type: 'number', default: 180}
  },
  init: function(){
    this.timeTracker = new TimeTracker(this.data.maxDataCount, this.data.chunkLength);

    //Set up a listener response object to pass reference to the internal time tracker
    //to any other object that cares to subscribe to the state of the current time
    let self = this;
    this.el.addEventListener('get-frame-timer-references', function(){
      self.el.emit('set-frame-timer-references', {
        timeTracker: self.timeTracker
      });
    });
  },
  tick: function(time, timeDelta){
    this.timeTracker.addTimeBetweenTicks(timeDelta);
  }
});
